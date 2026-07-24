import { randomUUID } from "node:crypto";
import * as NodeModule from "node:module";
import { MessageChannel, type MessagePort } from "node:worker_threads";
import {
  finishLoadingAttestedOcctRuntime,
  moduleImportFailure,
  moduleHookFailure,
  verifyOcctRuntimeRelease,
  type AttestedOcctRuntime,
  type LoadAttestedOcctRuntimeOptions,
} from "./internal/occt-runtime-attestation.js";

export {
  INVARIANTCAD_OCCT_FACADE_0_9_0_RELEASE_MANIFEST_SHA256,
  OcctRuntimeAttestationError,
  type AttestedOcctRuntime,
  type LoadAttestedOcctRuntimeOptions,
  type OcctRuntimeAttestation,
  type OcctRuntimeAttestationBytes,
  type OcctRuntimeAttestationFailureReason,
  type OcctRuntimeAttestationFile,
} from "./internal/occt-runtime-attestation.js";

const HOOK_READY_TIMEOUT_MS = 10_000;
const HOOK_EXPORT = "export";
const registerAsynchronousHooks = NodeModule.register;
const registerSynchronousHooks =
  typeof NodeModule.registerHooks === "function"
    ? NodeModule.registerHooks
    : undefined;
const HOOK_SOURCE = String.raw`
let port;
const bySpecifier = new Map();
const byUrl = new Map();

${HOOK_EXPORT} function initialize(data) {
  port = data.port;
  port.on("message", (message) => {
    if (message.kind === "install") {
      const entry = {
        id: message.id,
        specifier: message.specifier,
        url: message.url,
        source: message.source,
      };
      bySpecifier.set(entry.specifier, entry);
      byUrl.set(entry.url, entry);
      port.postMessage({ kind: "ready", id: entry.id });
      return;
    }
    if (message.kind === "cancel") {
      const entry = bySpecifier.get(message.specifier);
      if (entry !== undefined && entry.id === message.id) {
        bySpecifier.delete(entry.specifier);
        byUrl.delete(entry.url);
      }
    }
  });
}

${HOOK_EXPORT} async function resolve(specifier, context, nextResolve) {
  const entry = bySpecifier.get(specifier);
  if (entry === undefined) return nextResolve(specifier, context);
  return { url: entry.url, shortCircuit: true };
}

${HOOK_EXPORT} async function load(url, context, nextLoad) {
  const entry = byUrl.get(url);
  if (entry === undefined) return nextLoad(url, context);
  bySpecifier.delete(entry.specifier);
  byUrl.delete(entry.url);
  return {
    format: "module",
    source: entry.source,
    shortCircuit: true,
  };
}
`;

interface HookWaiter {
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface InstalledVerifiedModule {
  readonly specifier: string;
  readonly cleanup: () => void;
}

let hookPort: MessagePort | undefined;
const hookWaiters = new Map<string, HookWaiter>();

function rejectHookWaiters(error: unknown): void {
  for (const waiter of hookWaiters.values()) {
    clearTimeout(waiter.timeout);
    waiter.reject(error);
  }
  hookWaiters.clear();
}

function nodeHookPort(): MessagePort {
  if (hookPort !== undefined) return hookPort;
  const { port1, port2 } = new MessageChannel();
  port1.on("message", (value: unknown) => {
    if (
      typeof value !== "object" ||
      value === null ||
      (value as { kind?: unknown }).kind !== "ready" ||
      typeof (value as { id?: unknown }).id !== "string"
    ) {
      rejectHookWaiters(
        new TypeError("OCCT attestation loader hook returned malformed data"),
      );
      return;
    }
    const id = (value as { id: string }).id;
    const waiter = hookWaiters.get(id);
    if (waiter === undefined) return;
    hookWaiters.delete(id);
    clearTimeout(waiter.timeout);
    waiter.resolve();
  });
  port1.on("messageerror", (error) => {
    rejectHookWaiters(error);
  });
  const hookUrl = new URL(
    `data:text/javascript;charset=utf-8,${encodeURIComponent(HOOK_SOURCE)}`,
  );
  try {
    registerAsynchronousHooks(hookUrl, {
      parentURL: import.meta.url,
      data: { port: port2 },
      transferList: [port2],
    });
  } catch (error) {
    port1.close();
    port2.close();
    throw error;
  }
  port1.unref();
  hookPort = port1;
  return port1;
}

async function installVerifiedModuleWithAsynchronousHooks(
  source: Uint8Array,
): Promise<InstalledVerifiedModule> {
  const port = nodeHookPort();
  const id = randomUUID();
  const specifier = `invariantcad-attested:${id}`;
  const url = new URL(
    `./.invariantcad-attested/${id}/occt-wasm.mjs`,
    import.meta.url,
  ).href;
  port.ref();
  try {
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        hookWaiters.delete(id);
        reject(
          new Error(
            `OCCT attestation loader hook did not acknowledge within ${HOOK_READY_TIMEOUT_MS}ms`,
          ),
        );
      }, HOOK_READY_TIMEOUT_MS);
      hookWaiters.set(id, { resolve, reject, timeout });
    });
    port.postMessage(
      {
        kind: "install",
        id,
        specifier,
        url,
        source,
      },
      [source.buffer as ArrayBuffer],
    );
    await ready;
    let active = true;
    return {
      specifier,
      cleanup: () => {
        if (!active) return;
        active = false;
        try {
          port.postMessage({ kind: "cancel", id, specifier });
        } catch {
          // Source cleanup is best effort once the hook port itself has failed.
        }
      },
    };
  } catch (error) {
    const waiter = hookWaiters.get(id);
    if (waiter !== undefined) {
      hookWaiters.delete(id);
      clearTimeout(waiter.timeout);
    }
    try {
      port.postMessage({ kind: "cancel", id, specifier });
    } catch {
      // The original hook failure is more informative than cleanup failure.
    }
    throw error;
  } finally {
    try {
      port.unref();
    } catch {
      // A failed port is already unusable; do not mask the load result.
    }
  }
}

function installVerifiedModuleWithSynchronousHooks(
  source: Uint8Array,
): InstalledVerifiedModule {
  if (registerSynchronousHooks === undefined) {
    throw new Error("synchronous Node.js module hooks are unavailable");
  }
  const id = randomUUID();
  const specifier = `invariantcad-attested:${id}`;
  const url = new URL(
    `./.invariantcad-attested/${id}/occt-wasm.mjs`,
    import.meta.url,
  ).href;
  let pendingSource: Uint8Array | undefined = source;
  let active = true;
  const hooks = registerSynchronousHooks({
    resolve(candidate, context, nextResolve) {
      if (candidate !== specifier) return nextResolve(candidate, context);
      return { url, shortCircuit: true };
    },
    load(candidate, context, nextLoad) {
      if (candidate !== url) return nextLoad(candidate, context);
      const verifiedSource = pendingSource;
      pendingSource = undefined;
      if (verifiedSource === undefined) {
        throw new Error(
          "OCCT attestation loader source was already consumed",
        );
      }
      return {
        format: "module",
        source: verifiedSource,
        shortCircuit: true,
      };
    },
  });
  return {
    specifier,
    cleanup: () => {
      if (!active) return;
      active = false;
      pendingSource = undefined;
      try {
        hooks.deregister();
      } catch {
        // Cleanup must not replace the typed module import result.
      }
    },
  };
}

async function installVerifiedModule(
  source: Uint8Array,
): Promise<InstalledVerifiedModule> {
  return registerSynchronousHooks === undefined
    ? installVerifiedModuleWithAsynchronousHooks(source)
    : installVerifiedModuleWithSynchronousHooks(source);
}

/**
 * Verifies and imports an OCCT facade runtime in Node.js without writing the
 * verified JavaScript to a temporary file.
 *
 * Node 22.15 and newer use a short-lived synchronous, in-thread hook that is
 * deregistered after the import settles. Node 22.13 and 22.14 fall back to the
 * process-global asynchronous hook, which releases its raw source copy after
 * one load and requires worker permission under Node's permission model.
 */
export async function loadAttestedOcctRuntime(
  options: LoadAttestedOcctRuntimeOptions,
): Promise<AttestedOcctRuntime> {
  const verified = await verifyOcctRuntimeRelease(options);
  let installed: InstalledVerifiedModule;
  try {
    installed = await installVerifiedModule(verified.javascript);
  } catch (error) {
    throw moduleHookFailure(error);
  }
  let namespace: unknown;
  try {
    namespace = await import(
      /* @vite-ignore */ installed.specifier
    );
  } catch (error) {
    throw moduleImportFailure(error);
  } finally {
    installed.cleanup();
  }
  return finishLoadingAttestedOcctRuntime(verified, namespace);
}
