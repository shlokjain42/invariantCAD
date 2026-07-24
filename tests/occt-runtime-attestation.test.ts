import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import {
  createOcctKernel,
  type OcctModuleFactory,
  type OcctModuleOptions,
} from "../src/occt-kernel.js";
import {
  finishLoadingAttestedOcctRuntime,
  verifyOcctRuntimeRelease,
  type LoadAttestedOcctRuntimeOptions,
} from "../src/internal/occt-runtime-attestation.js";
import {
  INVARIANTCAD_OCCT_FACADE_0_9_0_RELEASE_MANIFEST_SHA256,
  OcctRuntimeAttestationError,
} from "../src/occt-runtime-node.js";
import { OCCT_SHAPE_ARTIFACT_CANDIDATE_ACCESS } from "../src/internal/occt-artifact-candidate.js";

const textEncoder = new TextEncoder();
const STATE_KEY = "__invariantCadRuntimeAttestationTest";
const FACADE_MARKER = "invariantcad-facade@0.2.0+occt-wasm.3.8.0";
const WEBASSEMBLY = new Uint8Array([9, 8, 7, 6]);
const JAVASCRIPT = textEncoder.encode(`
const state = globalThis.${STATE_KEY} ??= {
  imports: 0,
  factories: 0,
  constructed: 0,
  disposed: 0,
  wasmBuffers: []
};
state.imports += 1;
const topologyKind = Object.freeze({ NONE: -1, FACE: 0, EDGE: 1, VERTEX: 2 });
const topologyRelation = Object.freeze({
  PRESERVED: 0,
  MODIFIED: 1,
  GENERATED: 2,
  DELETED: 3,
  CREATED: 4
});
class MinimalRawKernel {
  constructor() { state.constructed += 1; }
  releaseAll() {}
  delete() { state.disposed += 1; }
}
export default async function createModule(options = {}) {
  state.factories += 1;
  const bytes = new Uint8Array(options.wasmBinary);
  if (
    bytes.length !== 4 ||
    bytes[0] !== 9 ||
    bytes[1] !== 8 ||
    bytes[2] !== 7 ||
    bytes[3] !== 6
  ) {
    throw new Error("factory did not receive the exact verified WASM bytes");
  }
  state.wasmBuffers.push(options.wasmBinary);
  return {
    OcctKernel: MinimalRawKernel,
    VectorUint32: class {},
    InvariantCadDraftReport: class {},
    InvariantCadTopologyKind: topologyKind,
    InvariantCadTopologyRelation: topologyRelation,
    invariantcadFacadeVersion: () => ${JSON.stringify(FACADE_MARKER)},
    invariantcadDraftFacesAtomic: () => {
      throw new Error("draft is not invoked by the attestation test");
    }
  };
}
`);

interface RuntimeTestState {
  imports: number;
  factories: number;
  constructed: number;
  disposed: number;
  wasmBuffers: ArrayBuffer[];
}

interface ManifestOptions {
  readonly bundleName?: string;
  readonly bundleVersion?: string;
  readonly layoutVersion?: number;
  readonly facadeMarker?: string;
  readonly abiVersion?: string;
  readonly upstreamOcctWasmVersion?: string;
  readonly buildScriptDigest?: string;
}

function digest(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function releaseManifestObject(
  javascript: Uint8Array,
  webassembly: Uint8Array,
  options: ManifestOptions = {},
) {
  const patch = {
    path: "source/native/occt/patches/0001-test.patch",
    size: 1,
    sha256: digest("patch"),
  };
  return {
    schemaVersion: 1,
    bundle: {
      name: options.bundleName ?? "invariantcad-occt-facade",
      version: options.bundleVersion ?? "0.2.0",
      layoutVersion: options.layoutVersion ?? 1,
    },
    facade: {
      marker: options.facadeMarker ?? FACADE_MARKER,
      abiVersion: options.abiVersion ?? "0.2.0",
      upstreamOcctWasmVersion:
        options.upstreamOcctWasmVersion ?? "3.8.0",
    },
    runtime: [
      {
        path: "runtime/occt-wasm.js",
        mediaType: "text/javascript",
        size: javascript.byteLength,
        sha256: digest(javascript),
      },
      {
        path: "runtime/occt-wasm.wasm",
        mediaType: "application/wasm",
        size: webassembly.byteLength,
        sha256: digest(webassembly),
      },
    ],
    source: {
      lockPath: "source/native/occt/upstream.lock.json",
      buildScriptPath: "source/scripts/build-occt-facade.sh",
      patches: [patch],
      relinkInstructionsPath: "SOURCE_AND_RELINK.md",
      materials: [
        {
          path: "source/native/occt/upstream.lock.json",
          role: "source-lock",
          size: 1,
          sha256: digest("lock"),
        },
        {
          path: patch.path,
          role: "source-patch",
          size: patch.size,
          sha256: patch.sha256,
        },
        {
          path: "source/scripts/build-occt-facade.sh",
          role: "build-script",
          size: 1,
          sha256: options.buildScriptDigest ?? digest("build"),
        },
      ],
    },
    integrity: {
      algorithm: "SHA-256",
      manifestPath: "SHA256SUMS",
      coverage: "all regular bundle files except SHA256SUMS",
    },
  };
}

function canonicalManifest(
  javascript = JAVASCRIPT,
  webassembly = WEBASSEMBLY,
  options: ManifestOptions = {},
): Uint8Array {
  return textEncoder.encode(
    `${JSON.stringify(
      releaseManifestObject(javascript, webassembly, options),
      undefined,
      2,
    )}\n`,
  );
}

function loaderOptions(
  javascript = JAVASCRIPT,
  webassembly = WEBASSEMBLY,
  manifest = canonicalManifest(javascript, webassembly),
): LoadAttestedOcctRuntimeOptions {
  return {
    releaseManifest: manifest,
    expectedReleaseManifestSha256: digest(manifest),
    javascript,
    webassembly,
  };
}

function state(): RuntimeTestState {
  return (globalThis as Record<string, unknown>)[STATE_KEY] as RuntimeTestState;
}

function ensureState(): RuntimeTestState {
  const existing = (globalThis as Record<string, unknown>)[STATE_KEY] as
    | RuntimeTestState
    | undefined;
  if (existing !== undefined) return existing;
  const created: RuntimeTestState = {
    imports: 0,
    factories: 0,
    constructed: 0,
    disposed: 0,
    wasmBuffers: [],
  };
  (globalThis as Record<string, unknown>)[STATE_KEY] = created;
  return created;
}

class AttestedMinimalRawKernel {
  constructor() {
    ensureState().constructed += 1;
  }

  releaseAll(): void {}

  delete(): void {
    ensureState().disposed += 1;
  }
}

const attestedTestFactory: OcctModuleFactory = async (options) => {
  const current = ensureState();
  current.factories += 1;
  const bytes = new Uint8Array(options?.wasmBinary ?? new ArrayBuffer(0));
  if (
    bytes.length !== WEBASSEMBLY.length ||
    bytes.some((byte, index) => byte !== WEBASSEMBLY[index])
  ) {
    throw new Error("factory did not receive the exact verified WASM bytes");
  }
  current.wasmBuffers.push(options!.wasmBinary!);
  return {
    OcctKernel: AttestedMinimalRawKernel,
    VectorUint32: class {},
    InvariantCadDraftReport: class {},
    InvariantCadTopologyKind: {
      NONE: -1,
      FACE: 0,
      EDGE: 1,
      VERTEX: 2,
    },
    InvariantCadTopologyRelation: {
      PRESERVED: 0,
      MODIFIED: 1,
      GENERATED: 2,
      DELETED: 3,
      CREATED: 4,
    },
    invariantcadFacadeVersion: () => FACADE_MARKER,
    invariantcadDraftFacesAtomic: () => {
      throw new Error("not invoked");
    },
  };
};

async function loadAttestedOcctRuntime(
  options: LoadAttestedOcctRuntimeOptions,
) {
  const verified = await verifyOcctRuntimeRelease(options);
  ensureState().imports += 1;
  return finishLoadingAttestedOcctRuntime(verified, {
    default: attestedTestFactory,
  });
}

function candidateFingerprint(kernel: unknown): string {
  const host = (
    kernel as {
      readonly [OCCT_SHAPE_ARTIFACT_CANDIDATE_ACCESS]?: {
        readonly compatibilityFingerprint: string;
      };
    }
  )[OCCT_SHAPE_ARTIFACT_CANDIDATE_ACCESS];
  if (host === undefined) throw new Error("candidate host was unavailable");
  return host.compatibilityFingerprint;
}

class DirectMinimalRawKernel {
  releaseAll(): void {}
  delete(): void {}
}

function directModuleFactory(): OcctModuleFactory {
  return async (_options?: OcctModuleOptions) => ({
    OcctKernel: DirectMinimalRawKernel,
    VectorUint32: class {},
    InvariantCadDraftReport: class {},
    InvariantCadTopologyKind: {
      NONE: -1,
      FACE: 0,
      EDGE: 1,
      VERTEX: 2,
    },
    InvariantCadTopologyRelation: {
      PRESERVED: 0,
      MODIFIED: 1,
      GENERATED: 2,
      DELETED: 3,
      CREATED: 4,
    },
    invariantcadFacadeVersion: () => FACADE_MARKER,
    invariantcadDraftFacesAtomic: () => {
      throw new Error("not invoked");
    },
  });
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[STATE_KEY];
});

describe("OCCT runtime attestation", () => {
  it("loads a frozen opaque pair and gives every kernel fresh verified WASM", async () => {
    const runtime = await loadAttestedOcctRuntime(loaderOptions());
    expect(runtime.attestation).toMatchObject({
      protocolVersion: 1,
      releaseManifestSha256: digest(canonicalManifest()),
      evidence: {
        exactReleaseManifestBytesVerified: true,
        exactRuntimeBytesVerified: true,
        buildExecutionObserved: false,
        buildExecutionAuthenticated: false,
        publisherAuthenticated: false,
        certifiesCompatibility: false,
      },
    });
    expect(runtime.attestation.runtimePairIdentity).toMatch(
      /^invariantcad-occt-runtime-pair@1:sha256:[0-9a-f]{64}$/u,
    );
    expect(runtime.attestation.declaredBuildIdentity).toBe(
      `invariantcad-occt-release-manifest@1:sha256:${digest(canonicalManifest())}`,
    );
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.isFrozen(runtime.attestation)).toBe(true);
    expect(Object.isFrozen(runtime.attestation.evidence)).toBe(true);
    expect(state()).toMatchObject({ imports: 1, factories: 0, constructed: 0 });

    const first = await createOcctKernel({ attestedRuntime: runtime });
    const second = await createOcctKernel({ attestedRuntime: runtime });
    try {
      expect(first.draft).toBeTypeOf("function");
      expect(second.draft).toBeTypeOf("function");
      expect(first.capabilities.shapeArtifacts).toBeUndefined();
      expect("encodeShapeArtifact" in first).toBe(false);
      expect("decodeShapeArtifact" in first).toBe(false);
      expect(state()).toMatchObject({
        imports: 1,
        factories: 2,
        constructed: 2,
      });
      expect(state().wasmBuffers).toHaveLength(2);
      expect(state().wasmBuffers[0]).not.toBe(state().wasmBuffers[1]);
      for (const buffer of state().wasmBuffers) {
        expect([...new Uint8Array(buffer)]).toEqual([...WEBASSEMBLY]);
      }
      expect(candidateFingerprint(first)).toContain(
        `runtimeAttestation=${runtime.attestation.runtimePairIdentity}`,
      );
    } finally {
      second.dispose();
      first.dispose();
    }
    expect(state().disposed).toBe(2);

    const reused = await createOcctKernel({ attestedRuntime: runtime });
    reused.dispose();
    expect(state()).toMatchObject({ imports: 1, factories: 3, disposed: 3 });
  });

  it("snapshots same-realm and cross-realm inputs before hashing", async () => {
    const manifest = canonicalManifest();
    const javascript = JAVASCRIPT.slice();
    const webassembly = WEBASSEMBLY.slice();
    const promise = loadAttestedOcctRuntime(
      loaderOptions(javascript, webassembly, manifest),
    );
    manifest.fill(0);
    javascript.fill(0);
    webassembly.fill(0);
    const runtime = await promise;
    const kernel = await createOcctKernel({ attestedRuntime: runtime });
    kernel.dispose();

    const foreign = runInNewContext(
      `({
        manifest: new Uint8Array(${JSON.stringify([...canonicalManifest()])}),
        javascript: new Uint8Array(${JSON.stringify([...JAVASCRIPT])}),
        webassembly: new Uint8Array([9, 8, 7, 6])
      })`,
    ) as {
      readonly manifest: Uint8Array;
      readonly javascript: Uint8Array;
      readonly webassembly: Uint8Array;
    };
    expect(foreign.javascript).not.toBeInstanceOf(Uint8Array);
    const foreignRuntime = await loadAttestedOcctRuntime({
      releaseManifest: foreign.manifest,
      expectedReleaseManifestSha256: digest(canonicalManifest()),
      javascript: foreign.javascript,
      webassembly: foreign.webassembly,
    });
    expect(foreignRuntime.attestation.runtimePairIdentity).toBe(
      runtime.attestation.runtimePairIdentity,
    );

    const bufferManifest = Buffer.from(canonicalManifest());
    const bufferJavascript = Buffer.from(JAVASCRIPT);
    const bufferWebassembly = Buffer.from(WEBASSEMBLY);
    Object.defineProperty(bufferJavascript, "slice", {
      value: () => {
        throw new Error("caller-controlled Buffer.slice must not run");
      },
    });
    const bufferPromise = loadAttestedOcctRuntime({
      releaseManifest: bufferManifest,
      expectedReleaseManifestSha256: digest(canonicalManifest()),
      javascript: bufferJavascript,
      webassembly: bufferWebassembly,
    });
    bufferManifest.fill(0);
    bufferJavascript.fill(0);
    bufferWebassembly.fill(0);
    const bufferRuntime = await bufferPromise;
    expect(bufferRuntime.attestation.runtimePairIdentity).toBe(
      runtime.attestation.runtimePairIdentity,
    );

    class HostileUint8Array extends Uint8Array<ArrayBuffer> {
      constructor(value: Uint8Array<ArrayBuffer>) {
        super(new ArrayBuffer(value.byteLength));
        Reflect.apply(Uint8Array.prototype.set, this, [value]);
      }

      override set(_array: ArrayLike<number>, _offset?: number): void {
        throw new Error("caller-controlled Uint8Array.set must not run");
      }

      override slice(
        _start?: number,
        _end?: number,
      ): Uint8Array<ArrayBuffer> {
        throw new Error("caller-controlled Uint8Array.slice must not run");
      }
    }
    Object.defineProperty(HostileUint8Array, Symbol.species, {
      get: () => {
        throw new Error("caller-controlled Uint8Array species must not run");
      },
    });
    const hostileJavascript = new HostileUint8Array(JAVASCRIPT);
    Object.defineProperties(hostileJavascript, {
      buffer: {
        get: () => {
          throw new Error("caller-controlled Uint8Array.buffer must not run");
        },
      },
      byteLength: {
        get: () => {
          throw new Error(
            "caller-controlled Uint8Array.byteLength must not run",
          );
        },
      },
    });
    const hostileRuntime = await loadAttestedOcctRuntime(
      loaderOptions(
        hostileJavascript,
        WEBASSEMBLY,
        canonicalManifest(),
      ),
    );
    expect(hostileRuntime.attestation.runtimePairIdentity).toBe(
      runtime.attestation.runtimePairIdentity,
    );
  });

  it("rejects SharedArrayBuffer-backed views instead of racing shared writes", async () => {
    if (typeof SharedArrayBuffer !== "function") return;
    const sharedJavascript = new Uint8Array(
      new SharedArrayBuffer(JAVASCRIPT.byteLength),
    );
    sharedJavascript.set(JAVASCRIPT);
    await expect(
      loadAttestedOcctRuntime(
        loaderOptions(
          sharedJavascript as unknown as Uint8Array<ArrayBuffer>,
        ),
      ),
    ).rejects.toMatchObject({
      name: "OcctRuntimeAttestationError",
      reason: "invalid-input",
    });
    expect((globalThis as Record<string, unknown>)[STATE_KEY]).toBeUndefined();
  });

  it("turns unreadable options and detached buffers into typed failures", async () => {
    await expect(
      loadAttestedOcctRuntime(null as unknown as LoadAttestedOcctRuntimeOptions),
    ).rejects.toMatchObject({
      name: "OcctRuntimeAttestationError",
      reason: "invalid-input",
    });

    const throwingOptions = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(throwingOptions, "expectedReleaseManifestSha256", {
      get: () => {
        throw new Error("caller-controlled option getter");
      },
    });
    await expect(
      loadAttestedOcctRuntime(
        throwingOptions as unknown as LoadAttestedOcctRuntimeOptions,
      ),
    ).rejects.toMatchObject({
      name: "OcctRuntimeAttestationError",
      reason: "invalid-input",
    });

    const detached = canonicalManifest().buffer as ArrayBuffer;
    structuredClone(detached, { transfer: [detached] });
    await expect(
      loadAttestedOcctRuntime({
        ...loaderOptions(),
        releaseManifest: detached,
      }),
    ).rejects.toMatchObject({
      name: "OcctRuntimeAttestationError",
      reason: "invalid-input",
    });

    const detachedView = canonicalManifest();
    structuredClone(detachedView.buffer, {
      transfer: [detachedView.buffer],
    });
    await expect(
      loadAttestedOcctRuntime({
        ...loaderOptions(),
        releaseManifest: detachedView,
      }),
    ).rejects.toMatchObject({
      name: "OcctRuntimeAttestationError",
      reason: "invalid-input",
    });
  });

  it("turns unavailable or failing Web Crypto into one typed failure", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    if (original?.configurable === false) return;
    try {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: undefined,
      });
      await expect(
        loadAttestedOcctRuntime(loaderOptions()),
      ).rejects.toMatchObject({
        name: "OcctRuntimeAttestationError",
        reason: "cryptography-unavailable",
      });

      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: {
          subtle: {
            digest: () => {
              throw new Error("host Web Crypto digest failure");
            },
          },
        },
      });
      await expect(
        loadAttestedOcctRuntime(loaderOptions()),
      ).rejects.toMatchObject({
        name: "OcctRuntimeAttestationError",
        reason: "cryptography-unavailable",
      });
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(globalThis, "crypto");
      } else {
        Object.defineProperty(globalThis, "crypto", original);
      }
    }
  });

  it.each([
    ["release manifest", "release-manifest-digest-mismatch"],
    ["javascript", "javascript-digest-mismatch"],
    ["webassembly", "webassembly-digest-mismatch"],
  ] as const)(
    "rejects one-byte %s tampering before importing JavaScript",
    async (component, reason) => {
      const options = loaderOptions();
      const tampered = {
        releaseManifest: new Uint8Array(options.releaseManifest as Uint8Array),
        javascript: new Uint8Array(options.javascript as Uint8Array),
        webassembly: new Uint8Array(options.webassembly as Uint8Array),
      };
      const tamperedComponent =
        tampered[
          component === "release manifest" ? "releaseManifest" : component
        ];
      tamperedComponent[0] = tamperedComponent[0]! ^ 1;
      await expect(
        loadAttestedOcctRuntime({
          ...options,
          ...tampered,
        }),
      ).rejects.toMatchObject({
        name: "OcctRuntimeAttestationError",
        reason,
      });
      expect(
        (globalThis as Record<string, unknown>)[STATE_KEY],
      ).toBeUndefined();
    },
  );

  it("rejects a coherently rehashed attacker manifest against the independent pin", async () => {
    const tamperedJavascript = JAVASCRIPT.slice();
    const tamperedIndex = tamperedJavascript.byteLength - 2;
    tamperedJavascript[tamperedIndex] =
      tamperedJavascript[tamperedIndex]! ^ 1;
    const attackerManifest = canonicalManifest(
      tamperedJavascript,
      WEBASSEMBLY,
    );
    await expect(
      loadAttestedOcctRuntime({
        releaseManifest: attackerManifest,
        expectedReleaseManifestSha256: digest(canonicalManifest()),
        javascript: tamperedJavascript,
        webassembly: WEBASSEMBLY,
      }),
    ).rejects.toMatchObject({
      reason: "release-manifest-digest-mismatch",
    });
    expect((globalThis as Record<string, unknown>)[STATE_KEY]).toBeUndefined();
  });

  it("rejects noncanonical and default-less verified JavaScript", async () => {
    const compactManifest = textEncoder.encode(
      JSON.stringify(releaseManifestObject(JAVASCRIPT, WEBASSEMBLY)),
    );
    await expect(
      loadAttestedOcctRuntime(
        loaderOptions(JAVASCRIPT, WEBASSEMBLY, compactManifest),
      ),
    ).rejects.toMatchObject({
      reason: "invalid-release-manifest",
    });

    const noDefault = textEncoder.encode("export const value = 1;\n");
    const verified = await verifyOcctRuntimeRelease(
      loaderOptions(noDefault),
    );
    expect(() =>
      finishLoadingAttestedOcctRuntime(verified, { value: 1 }),
    ).toThrow(
      expect.objectContaining({
        reason: "module-factory-missing",
      }),
    );
  });

  it.each([
    ["bundle name", { bundleName: "another-facade" }],
    ["layout version", { layoutVersion: 2 }],
    ["bundle/ABI version", { bundleVersion: "0.3.0" }],
    ["marker/ABI version", { abiVersion: "0.3.0" }],
    ["marker/upstream version", { upstreamOcctWasmVersion: "3.9.0" }],
  ] as const)(
    "rejects internally inconsistent %s metadata",
    async (_label, manifestOptions) => {
      const manifest = canonicalManifest(
        JAVASCRIPT,
        WEBASSEMBLY,
        manifestOptions,
      );
      await expect(
        loadAttestedOcctRuntime(
          loaderOptions(JAVASCRIPT, WEBASSEMBLY, manifest),
        ),
      ).rejects.toMatchObject({
        name: "OcctRuntimeAttestationError",
        reason: "invalid-release-manifest",
      });
      expect((globalThis as Record<string, unknown>)[STATE_KEY]).toBeUndefined();
    },
  );

  it("keeps runtime-pair and declared-build identities separate", async () => {
    const firstManifest = canonicalManifest();
    const secondManifest = canonicalManifest(JAVASCRIPT, WEBASSEMBLY, {
      buildScriptDigest: digest("reviewed-build-metadata-variant"),
    });
    const [first, second] = await Promise.all([
      loadAttestedOcctRuntime(
        loaderOptions(JAVASCRIPT, WEBASSEMBLY, firstManifest),
      ),
      loadAttestedOcctRuntime(
        loaderOptions(JAVASCRIPT, WEBASSEMBLY, secondManifest),
      ),
    ]);
    expect(second.attestation.runtimePairIdentity).toBe(
      first.attestation.runtimePairIdentity,
    );
    expect(second.attestation.declaredBuildIdentity).not.toBe(
      first.attestation.declaredBuildIdentity,
    );

    const changedJavascript = new Uint8Array([
      ...JAVASCRIPT,
      ...textEncoder.encode("\n// runtime-pair variant\n"),
    ]);
    const changed = await loadAttestedOcctRuntime(
      loaderOptions(changedJavascript),
    );
    expect(changed.attestation.runtimePairIdentity).not.toBe(
      first.attestation.runtimePairIdentity,
    );

    const [firstKernel, secondKernel, changedKernel] = await Promise.all([
      createOcctKernel({ attestedRuntime: first }),
      createOcctKernel({ attestedRuntime: second }),
      createOcctKernel({ attestedRuntime: changed }),
    ]);
    try {
      expect(candidateFingerprint(secondKernel)).toBe(
        candidateFingerprint(firstKernel),
      );
      expect(candidateFingerprint(changedKernel)).not.toBe(
        candidateFingerprint(firstKernel),
      );
    } finally {
      changedKernel.dispose();
      secondKernel.dispose();
      firstKernel.dispose();
    }
  });

  it("binds the pair identity only to private artifact compatibility", async () => {
    const runtime = await loadAttestedOcctRuntime(loaderOptions());
    const attested = await createOcctKernel({ attestedRuntime: runtime });
    const direct = await createOcctKernel({
      moduleFactory: directModuleFactory(),
      wasm: WEBASSEMBLY,
    });
    try {
      expect(attested.capabilities.topology?.signatures).toEqual(
        direct.capabilities.topology?.signatures,
      );
      expect(candidateFingerprint(attested)).not.toBe(
        candidateFingerprint(direct),
      );
      expect(candidateFingerprint(attested)).toContain(
        runtime.attestation.runtimePairIdentity,
      );
      expect(candidateFingerprint(direct)).not.toContain(
        "runtimeAttestation=",
      );
    } finally {
      direct.dispose();
      attested.dispose();
    }
  });

  it("rejects forged or mixed kernel configuration before factory invocation", async () => {
    const runtime = await loadAttestedOcctRuntime(loaderOptions());
    expect(state().factories).toBe(0);
    await expect(
      createOcctKernel({
        attestedRuntime: runtime,
        wasm: WEBASSEMBLY,
      }),
    ).rejects.toThrow(TypeError);
    await expect(
      createOcctKernel({
        attestedRuntime: runtime,
        moduleFactory: directModuleFactory(),
      }),
    ).rejects.toThrow(TypeError);
    await expect(
      createOcctKernel({
        attestedRuntime: {
          attestation: runtime.attestation,
        } as typeof runtime,
      }),
    ).rejects.toThrow("opaque runtime");
    expect(state().factories).toBe(0);
  });

  it("fails a trusted facade mismatch before raw-kernel construction", async () => {
    const manifest = canonicalManifest(JAVASCRIPT, WEBASSEMBLY, {
      facadeMarker: "invariantcad-facade@0.3.0+occt-wasm.3.8.0",
      abiVersion: "0.3.0",
      bundleVersion: "0.3.0",
    });
    const runtime = await loadAttestedOcctRuntime(
      loaderOptions(JAVASCRIPT, WEBASSEMBLY, manifest),
    );
    await expect(
      createOcctKernel({ attestedRuntime: runtime }),
    ).rejects.toMatchObject({
      name: "OcctRuntimeAttestationError",
      reason: "facade-marker-mismatch",
    });
    expect(state()).toMatchObject({
      imports: 1,
      factories: 1,
      constructed: 0,
    });
  });

  it("keeps the reviewed owned release-manifest trust pin exact", () => {
    expect(INVARIANTCAD_OCCT_FACADE_0_9_0_RELEASE_MANIFEST_SHA256).toBe(
      "9973552922d4dd67aa9c79e3a9cdfcbfe0140c52d4cc3d7b567935d7dfa4f708",
    );
    expect(
      new OcctRuntimeAttestationError(
        "invalid-input",
        "test",
      ),
    ).toMatchObject({
      name: "OcctRuntimeAttestationError",
      reason: "invalid-input",
    });
  });
});
