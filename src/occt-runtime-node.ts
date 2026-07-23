import { randomUUID } from "node:crypto";
import { register } from "node:module";
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
    register(hookUrl, {
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

async function installVerifiedModule(
  source: Uint8Array,
): Promise<{
  readonly id: string;
  readonly specifier: string;
}> {
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
    return { id, specifier };
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

/**
 * Verifies and imports an OCCT facade runtime in Node.js without writing the
 * verified JavaScript to a temporary file.
 *
 * Node's process-global module hook and evaluated module remain installed for
 * the lifetime of the process. The hook releases its raw source copy after one
 * load. Node's permission model requires worker permission for module hooks.
 */
export async function loadAttestedOcctRuntime(
  options: LoadAttestedOcctRuntimeOptions,
): Promise<AttestedOcctRuntime> {
  const verified = await verifyOcctRuntimeRelease(options);
  let installed: {
    readonly id: string;
    readonly specifier: string;
  };
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
    if (hookPort !== undefined) {
      try {
        hookPort.postMessage({
          kind: "cancel",
          id: installed.id,
          specifier: installed.specifier,
        });
      } catch {
        // Source cleanup is best effort once the hook port itself has failed.
      }
    }
  }
  return finishLoadingAttestedOcctRuntime(verified, namespace);
}
