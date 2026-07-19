import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  truncate,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { gzipSync, gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");
const verifierPath = join(repoRoot, "scripts/verify-occt-facade-bundle.mjs");
const packagerPath = join(repoRoot, "scripts/package-occt-facade-bundle.mjs");
const descriptorPath = join(repoRoot, "native/occt/bundle/release-input.json");
const lockPath = join(repoRoot, "native/occt/upstream.lock.json");
const bundleVersion = "0.4.0";
const bundleName = `invariantcad-occt-facade-${bundleVersion}`;
const facadeMarker = `invariantcad-facade@${bundleVersion}+occt-wasm.3.7.0`;
const pipeShellPatchSource =
  "native/occt/patches/0003-controlled-pipe-shell.patch";
const pipeShellPatchTarget = `source/${pipeShellPatchSource}`;
const temporaryRoots: string[] = [];

interface LockedEntry {
  readonly source: string;
  readonly target: string;
  readonly size: number;
  readonly sha256: string;
  readonly mediaType?: string;
  readonly role?: string;
  readonly mode?: string;
}

interface ReleaseInput {
  readonly bundle: {
    readonly name: string;
    readonly version: string;
    readonly layoutVersion: number;
  };
  readonly facade: {
    readonly marker: string;
    readonly abiVersion: string;
    readonly upstreamOcctWasmVersion: string;
  };
  readonly archive: {
    readonly format: string;
    readonly size: number;
    readonly sha256: string;
  };
  readonly runtime: readonly LockedEntry[];
  readonly inputs: readonly LockedEntry[];
}

interface RuntimePin {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

interface Fixture {
  readonly root: string;
  readonly bundle: string;
  readonly trustedRuntime: readonly RuntimePin[];
  readonly trustedReleaseInput: ReleaseInput;
}

interface TestVerifier {
  verifyOcctFacadeBundle(inputPath: string): Promise<unknown>;
  verifyOcctFacadeBundleWithTestRuntime(
    inputPath: string,
    trustedRuntime: readonly RuntimePin[],
    trustedReleaseInput: ReleaseInput,
  ): Promise<unknown>;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, undefined, 2)}\n`;
}

async function loadVerifier(): Promise<TestVerifier> {
  return (await import(pathToFileURL(verifierPath).href)) as TestVerifier;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stableJson(value));
}

async function listFiles(root: string, directory = root): Promise<string[]> {
  const files: string[] = [];
  for (const name of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    Buffer.from(a.name).compare(Buffer.from(b.name)),
  )) {
    const path = join(directory, name.name);
    if (name.isDirectory()) files.push(...(await listFiles(root, path)));
    else files.push(path.slice(root.length + 1).split("\\").join("/"));
  }
  return files;
}

async function normalizeFixtureModes(root: string, directory = root): Promise<void> {
  await chmod(directory, 0o755);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await normalizeFixtureModes(root, path);
      continue;
    }
    const relative = path.slice(root.length + 1).split("\\").join("/");
    await chmod(
      path,
      relative === "source/scripts/build-occt-facade.sh" ? 0o755 : 0o644,
    );
  }
}

async function refreshManifest(bundle: string): Promise<void> {
  const paths = (await listFiles(bundle))
    .filter((path) => path !== "SHA256SUMS")
    .sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
  const lines = await Promise.all(
    paths.map(async (path) => `${sha256(await readFile(join(bundle, ...path.split("/"))))}  ${path}`),
  );
  await writeFile(join(bundle, "SHA256SUMS"), `${lines.join("\n")}\n`);
}

function syntheticWasm(): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
    Buffer.from(
      [
        facadeMarker,
        "invariantcadFacadeVersion",
        "invariantcadDraftFacesAtomic",
        "InvariantCadDraftReport",
        "InvariantCadPipeShellReport",
        "InvariantCadBooleanOperation",
        "InvariantCadBooleanReport",
        "InvariantCadTopologyKind",
        "InvariantCadTopologyRelation",
        "invariantcadPipeShellSolid",
        "invariantcadBooleanAtomic",
      ].join("\0"),
    ),
  ]);
}

async function makeFixtureReleaseInput(): Promise<ReleaseInput> {
  const current = JSON.parse(
    await readFile(descriptorPath, "utf8"),
  ) as ReleaseInput;
  const patchBytes = await readFile(join(repoRoot, pipeShellPatchSource));
  const pipeShellPatch: LockedEntry = {
    source: pipeShellPatchSource,
    target: pipeShellPatchTarget,
    role: "source-patch",
    mode: "0644",
    size: patchBytes.length,
    sha256: sha256(patchBytes),
  };
  const inputs = current.inputs.filter(
    (entry) => entry.target !== pipeShellPatchTarget,
  );
  const nextPatchIndex = inputs.findIndex(
    (entry) =>
      entry.target ===
      "source/native/occt/patches/0004-exact-boolean-history.patch",
  );
  if (nextPatchIndex === -1) {
    throw new Error("Fixture release input lacks the exact Boolean patch");
  }
  inputs.splice(nextPatchIndex, 0, pipeShellPatch);
  return {
    ...current,
    bundle: { ...current.bundle, version: bundleVersion },
    facade: {
      ...current.facade,
      marker: facadeMarker,
      abiVersion: bundleVersion,
    },
    inputs,
  };
}

function makeRelease(descriptor: ReleaseInput, runtime: readonly LockedEntry[]) {
  const source = descriptor.inputs.filter((entry) => entry.target.startsWith("source/"));
  return {
    schemaVersion: 1,
    bundle: {
      name: descriptor.bundle.name,
      version: descriptor.bundle.version,
      layoutVersion: descriptor.bundle.layoutVersion,
    },
    facade: descriptor.facade,
    runtime: runtime.map(({ target: path, mediaType, size, sha256: digest }) => ({
      path,
      mediaType,
      size,
      sha256: digest,
    })),
    source: {
      lockPath: "source/native/occt/upstream.lock.json",
      buildScriptPath: "source/scripts/build-occt-facade.sh",
      patches: source
        .filter((entry) => entry.role === "source-patch")
        .map(({ target: path, size, sha256: digest }) => ({ path, size, sha256: digest })),
      relinkInstructionsPath: "SOURCE_AND_RELINK.md",
      materials: source.map(({ target: path, role, size, sha256: digest }) => ({
        path,
        role,
        size,
        sha256: digest,
      })),
    },
    integrity: {
      algorithm: "SHA-256",
      manifestPath: "SHA256SUMS",
      coverage: "all regular bundle files except SHA256SUMS",
    },
  };
}

function makeSbom(descriptor: ReleaseInput, runtime: readonly LockedEntry[], lock: any) {
  const facadeRef = `pkg:generic/${descriptor.bundle.name}@${descriptor.bundle.version}`;
  const wrapperRef = `pkg:generic/occt-wasm@${descriptor.facade.upstreamOcctWasmVersion}`;
  const occtRef = `pkg:generic/opencascade-technology@${lock.occt.commit}`;
  const builderRef = `oci:${lock.builder.image}@${lock.builder.digest}`;
  const runtimeComponents = runtime.map((entry) => ({
    type: "file",
    "bom-ref": `file:${entry.target}`,
    name: entry.target.split("/").at(-1),
    version: descriptor.bundle.version,
    hashes: [{ alg: "SHA-256", content: entry.sha256 }],
    properties: [
      { name: "invariantcad:bundle:path", value: entry.target },
      { name: "invariantcad:file:size", value: String(entry.size) },
    ],
  }));
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      component: {
        type: "library",
        "bom-ref": facadeRef,
        name: descriptor.bundle.name,
        version: descriptor.bundle.version,
        licenses: [{ license: { id: "Apache-2.0" } }],
        properties: [
          { name: "invariantcad:facade:marker", value: descriptor.facade.marker },
          {
            name: "invariantcad:sbom:scope",
            value: "Package-neutral component inventory; not a legal-compliance determination.",
          },
          {
            name: "invariantcad:bundle:identity",
            value: `${descriptor.bundle.name}@${descriptor.bundle.version}`,
          },
        ],
      },
    },
    components: [
      ...runtimeComponents,
      {
        type: "library",
        "bom-ref": wrapperRef,
        name: "occt-wasm",
        version: descriptor.facade.upstreamOcctWasmVersion,
        licenses: [{ license: { id: "MIT" } }],
        externalReferences: [
          {
            type: "vcs",
            url: lock.upstream.repository,
            hashes: [{ alg: "SHA-1", content: lock.upstream.commit }],
          },
        ],
        properties: [
          { name: "invariantcad:source:commit", value: lock.upstream.commit },
        ],
      },
      {
        type: "library",
        "bom-ref": occtRef,
        name: "Open CASCADE Technology",
        version: lock.occt.commit,
        licenses: [{ expression: "LGPL-2.1-only WITH OCCT-exception-1.0" }],
        externalReferences: [
          {
            type: "vcs",
            url: lock.occt.repository,
            hashes: [{ alg: "SHA-1", content: lock.occt.commit }],
          },
        ],
        properties: [
          { name: "invariantcad:source:commit", value: lock.occt.commit },
        ],
      },
      {
        type: "application",
        "bom-ref": `tool:emscripten@${lock.toolchain.emscripten}`,
        name: "Emscripten",
        version: lock.toolchain.emscripten,
        scope: "excluded",
        properties: [{ name: "invariantcad:component:role", value: "build-tool" }],
      },
      {
        type: "application",
        "bom-ref": `tool:rust@${lock.toolchain.rust}`,
        name: "Rust",
        version: lock.toolchain.rust,
        scope: "excluded",
        properties: [{ name: "invariantcad:component:role", value: "build-tool" }],
      },
      {
        type: "container",
        "bom-ref": builderRef,
        name: lock.builder.image,
        version: lock.builder.digest,
        scope: "excluded",
        hashes: [
          { alg: "SHA-256", content: lock.builder.digest.replace("sha256:", "") },
        ],
        properties: [
          { name: "invariantcad:component:role", value: "build-environment" },
          { name: "invariantcad:builder:platform", value: lock.builder.platform },
        ],
      },
    ],
    dependencies: [
      { ref: facadeRef, dependsOn: runtimeComponents.map((entry) => entry["bom-ref"]) },
      { ref: "file:runtime/occt-wasm.js", dependsOn: [wrapperRef] },
      { ref: "file:runtime/occt-wasm.wasm", dependsOn: [wrapperRef, occtRef] },
      { ref: wrapperRef, dependsOn: [occtRef] },
      { ref: occtRef, dependsOn: [] },
    ],
  };
}

function makeProvenance(descriptor: ReleaseInput, runtime: readonly LockedEntry[], lock: any) {
  const source = descriptor.inputs.filter((entry) => entry.target.startsWith("source/"));
  return {
    _type: "https://in-toto.io/Statement/v1",
    subject: runtime.map((entry) => ({
      name: entry.target,
      digest: { sha256: entry.sha256 },
    })),
    predicateType: "https://invariantcad.dev/provenance/occt-facade-recipe/v1",
    predicate: {
      evidenceKind: "verified-recipe-and-artifact-metadata",
      buildDefinition: {
        buildType: "https://invariantcad.dev/build-types/digest-pinned-occt-facade/v1",
        externalParameters: {
          upstream: lock.upstream,
          occt: lock.occt,
          toolchain: lock.toolchain,
          builder: lock.builder,
        },
        internalParameters: {
          facadeMarker: descriptor.facade.marker,
          patchOrder: source
            .filter((entry) => entry.role === "source-patch")
            .map((entry) => entry.target),
          buildScript: "source/scripts/build-occt-facade.sh",
          compileNetwork: "none",
        },
        resolvedDependencies: [
          {
            uri: `git+${lock.upstream.repository}@${lock.upstream.commit}`,
            digest: { sha1: lock.upstream.commit },
          },
          {
            uri: `git+${lock.occt.repository}@${lock.occt.commit}`,
            digest: { sha1: lock.occt.commit },
          },
          {
            uri: `oci://${lock.builder.image}@${lock.builder.digest}`,
            digest: { sha256: lock.builder.digest.replace("sha256:", "") },
          },
          ...source.map((entry) => ({
            uri: `file:${entry.target}`,
            digest: { sha256: entry.sha256 },
          })),
        ],
      },
      runDetails: {
        builder: {
          id: "https://invariantcad.dev/builders/rootless-podman-occt-facade/v1",
          image: `${lock.builder.image}@${lock.builder.digest}`,
          platform: lock.builder.platform,
        },
        metadata: {
          buildExecutionObserved: false,
          buildExecutionAuthenticated: false,
          archiveNormalization:
            "GNU ustar with bytewise path order, epoch-zero timestamps, numeric root ownership, normalized modes, and gzip -n -9",
        },
      },
      limitations: {
        signed: false,
        statement:
          "The packager verified locked inputs and runtime bytes but did not observe or authenticate the earlier build execution.",
      },
    },
  };
}

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "invariantcad-bundle-test-"));
  temporaryRoots.push(root);
  const bundle = join(root, bundleName);
  await mkdir(bundle, { recursive: true });
  const descriptor = await makeFixtureReleaseInput();
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as any;
  for (const entry of descriptor.inputs) {
    const target = join(bundle, ...entry.target.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(repoRoot, entry.source), target);
    await chmod(target, Number.parseInt(entry.mode ?? "0644", 8));
  }

  const runtimeBytes = [
    Buffer.from('const wasmFile = "occt-wasm.wasm"; export default wasmFile;\n'),
    syntheticWasm(),
  ];
  const runtime = descriptor.runtime.map((entry, index) => {
    const bytes = runtimeBytes[index]!;
    return { ...entry, size: bytes.length, sha256: sha256(bytes) };
  });
  for (const [index, entry] of runtime.entries()) {
    const target = join(bundle, ...entry.target.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, runtimeBytes[index]!);
  }
  await writeJson(join(bundle, "metadata/release.json"), makeRelease(descriptor, runtime));
  await writeJson(join(bundle, "metadata/sbom.cdx.json"), makeSbom(descriptor, runtime, lock));
  await writeJson(
    join(bundle, "metadata/provenance.json"),
    makeProvenance(descriptor, runtime, lock),
  );
  await refreshManifest(bundle);
  await normalizeFixtureModes(bundle);
  return {
    root,
    bundle,
    trustedRuntime: runtime.map((entry) => ({
      path: entry.target,
      size: entry.size,
      sha256: entry.sha256,
    })),
    trustedReleaseInput: descriptor,
  };
}

async function verifyFixture(fixture: Fixture): Promise<unknown> {
  const verifier = await loadVerifier();
  return verifier.verifyOcctFacadeBundleWithTestRuntime(
    fixture.bundle,
    fixture.trustedRuntime,
    fixture.trustedReleaseInput,
  );
}

async function makeNormalizedArchive(fixture: Fixture): Promise<{
  readonly archive: string;
  readonly tar: string;
}> {
  const tar = join(fixture.root, "fixture.tar");
  const archive = join(fixture.root, `${bundleName}.tar.gz`);
  const treeEntries: Array<{
    readonly path: string;
    readonly directory: boolean;
    readonly bytes: Buffer;
  }> = [{ path: bundleName, directory: true, bytes: Buffer.alloc(0) }];

  async function collectTree(directory: string, relativeDirectory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = relativeDirectory === ""
        ? entry.name
        : `${relativeDirectory}/${entry.name}`;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        treeEntries.push({
          path: `${bundleName}/${relative}`,
          directory: true,
          bytes: Buffer.alloc(0),
        });
        await collectTree(path, relative);
      } else {
        treeEntries.push({
          path: `${bundleName}/${relative}`,
          directory: false,
          bytes: await readFile(path),
        });
      }
    }
  }

  await collectTree(fixture.bundle, "");
  treeEntries.sort((left, right) =>
    Buffer.from(left.path).compare(Buffer.from(right.path)),
  );
  const chunks: Buffer[] = [];
  for (const entry of treeEntries) {
    const archivePath = entry.directory ? `${entry.path}/` : entry.path;
    const { name, prefix } = splitUstarPath(archivePath);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "utf8");
    writeTarOctal(
      header,
      100,
      8,
      entry.directory || entry.path.endsWith("/source/scripts/build-occt-facade.sh")
        ? 0o755
        : 0o644,
    );
    writeTarOctal(header, 108, 8, 0);
    writeTarOctal(header, 116, 8, 0);
    writeTarOctal(header, 124, 12, entry.bytes.length);
    writeTarOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header[156] = entry.directory ? "5".charCodeAt(0) : "0".charCodeAt(0);
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    header.write(prefix, 345, 155, "utf8");
    refreshTarChecksum(header);
    chunks.push(header, entry.bytes);
    const padding = (512 - (entry.bytes.length % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  const tarBytes = Buffer.concat(chunks);
  await writeFile(tar, tarBytes);
  await writeFile(archive, normalizedGzip(tarBytes));
  return { archive, tar };
}

function splitUstarPath(path: string): { readonly name: string; readonly prefix: string } {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: "" };
  for (let index = path.lastIndexOf("/"); index > 0; index = path.lastIndexOf("/", index - 1)) {
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }
  throw new Error(`path cannot be represented in ustar: ${path}`);
}

async function expectNormalizedModes(root: string, directory = root): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const metadata = await stat(path);
    if (entry.isDirectory()) {
      expect(metadata.mode & 0o777, path).toBe(0o755);
      await expectNormalizedModes(root, path);
    } else {
      const relative = path.slice(root.length + 1).split("\\").join("/");
      expect(metadata.mode & 0o777, relative).toBe(
        relative === "source/scripts/build-occt-facade.sh" ? 0o755 : 0o644,
      );
    }
  }
}

function tarEntrySpans(tar: Buffer): Array<{ offset: number; length: number; path: string }> {
  const entries: Array<{ offset: number; length: number; path: string }> = [];
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const nul = header.indexOf(0);
    const name = header.subarray(0, nul === -1 ? 100 : Math.min(nul, 100)).toString();
    const sizeText = header.subarray(124, 136).toString().replace(/\0.*$/u, "").trim();
    const size = Number.parseInt(sizeText === "" ? "0" : sizeText, 8);
    const length = 512 + Math.ceil(size / 512) * 512;
    entries.push({ offset, length, path: name.replace(/\/$/u, "") });
    offset += length;
  }
  return entries;
}

function writeTarOctal(header: Buffer, offset: number, length: number, value: number): void {
  const field = `${value.toString(8).padStart(length - 1, "0")}\0`;
  header.write(field, offset, length, "ascii");
}

function refreshTarChecksum(header: Buffer): void {
  header.fill(0x20, 148, 156);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
}

function normalizedGzip(tar: Buffer): Buffer {
  const archive = gzipSync(tar, { level: 9 });
  expect([...archive.subarray(0, 10)]).toEqual([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x02, 0x03]);
  return archive;
}

async function coherentlyTamperRuntime(fixture: Fixture, path: string): Promise<void> {
  const absolutePath = join(fixture.bundle, ...path.split("/"));
  const bytes = Buffer.concat([await readFile(absolutePath), Buffer.from("tampered")]);
  await writeFile(absolutePath, bytes);
  const digest = sha256(bytes);

  const releasePath = join(fixture.bundle, "metadata/release.json");
  const release = JSON.parse(await readFile(releasePath, "utf8"));
  const runtime = release.runtime.find((entry: any) => entry.path === path);
  runtime.size = bytes.length;
  runtime.sha256 = digest;
  await writeJson(releasePath, release);

  const sbomPath = join(fixture.bundle, "metadata/sbom.cdx.json");
  const sbom = JSON.parse(await readFile(sbomPath, "utf8"));
  const component = sbom.components.find((entry: any) => entry["bom-ref"] === `file:${path}`);
  component.hashes[0].content = digest;
  component.properties.find((entry: any) => entry.name === "invariantcad:file:size").value =
    String(bytes.length);
  await writeJson(sbomPath, sbom);

  const provenancePath = join(fixture.bundle, "metadata/provenance.json");
  const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
  provenance.subject.find((entry: any) => entry.name === path).digest.sha256 = digest;
  await writeJson(provenancePath, provenance);
  await refreshManifest(fixture.bundle);
}

describe("OCCT facade compliance bundle verification", () => {
  it("accepts a complete internally consistent fixture against explicit test runtime pins", async () => {
    const fixture = await makeFixture();
    await expect(verifyFixture(fixture)).resolves.toMatchObject({
      ok: true,
      format: "directory",
      name: "invariantcad-occt-facade",
      version: bundleVersion,
    });
  });

  it("accepts the same fixture as an exactly normalized ustar/gzip archive", async () => {
    const fixture = await makeFixture();
    const { archive } = await makeNormalizedArchive(fixture);
    const verifier = await loadVerifier();
    await expect(
      verifier.verifyOcctFacadeBundleWithTestRuntime(
        archive,
        fixture.trustedRuntime,
        fixture.trustedReleaseInput,
      ),
    ).resolves.toMatchObject({ ok: true, format: "tar.gz" });
  });

  it("rejects a directory bundle with non-normalized file modes", async () => {
    const fixture = await makeFixture();
    await chmod(
      join(fixture.bundle, "source/scripts/build-occt-facade.sh"),
      0o644,
    );
    await expect(verifyFixture(fixture)).rejects.toThrow(
      /bundle file .* mode is 644; expected 755/u,
    );
  });

  it.each(["runtime/occt-wasm.js", "runtime/occt-wasm.wasm"])(
    "rejects coherently rehashed tampering of %s against independent pins",
    async (path) => {
      const fixture = await makeFixture();
      await coherentlyTamperRuntime(fixture, path);
      await expect(verifyFixture(fixture)).rejects.toThrow(/trusted release (size|SHA-256) mismatch/u);
    },
  );

  it("rejects manifest digest tampering", async () => {
    const fixture = await makeFixture();
    const manifestPath = join(fixture.bundle, "SHA256SUMS");
    const manifest = await readFile(manifestPath, "utf8");
    await writeFile(manifestPath, manifest.replace(/^[0-9a-f]/u, "0"));
    await expect(verifyFixture(fixture)).rejects.toThrow(/SHA-256 mismatch/u);
  });

  it("rejects coherently rehashed facade version tampering", async () => {
    const fixture = await makeFixture();
    const releasePath = join(fixture.bundle, "metadata/release.json");
    const release = JSON.parse(await readFile(releasePath, "utf8"));
    release.bundle.version = "0.3.1";
    await writeJson(releasePath, release);
    await refreshManifest(fixture.bundle);
    await expect(verifyFixture(fixture)).rejects.toThrow(
      /release\.bundle\.version|canonical generated JSON/u,
    );
  });

  it("rejects a missing compliance file even after the manifest is regenerated", async () => {
    const fixture = await makeFixture();
    await unlink(join(fixture.bundle, "licenses/OCCT_LGPL_EXCEPTION.txt"));
    await refreshManifest(fixture.bundle);
    await expect(verifyFixture(fixture)).rejects.toThrow(/required layout/u);
  });

  it("rejects unsafe and duplicate manifest paths", async () => {
    const unsafe = await makeFixture();
    const unsafeManifestPath = join(unsafe.bundle, "SHA256SUMS");
    const unsafeManifest = await readFile(unsafeManifestPath, "utf8");
    await writeFile(
      unsafeManifestPath,
      unsafeManifest.replace("  LICENSE\n", "  ../LICENSE\n"),
    );
    await expect(verifyFixture(unsafe)).rejects.toThrow(/path is unsafe/u);

    const duplicate = await makeFixture();
    const duplicateManifestPath = join(duplicate.bundle, "SHA256SUMS");
    const lines = (await readFile(duplicateManifestPath, "utf8")).trimEnd().split("\n");
    lines.splice(1, 0, lines[0]!);
    await writeFile(duplicateManifestPath, `${lines.join("\n")}\n`);
    await expect(verifyFixture(duplicate)).rejects.toThrow(/duplicate path/u);
  });

  it("rejects unsafe and duplicate tar entry paths before reading payload metadata", async () => {
    const fixture = await makeFixture();
    const { tar } = await makeNormalizedArchive(fixture);
    const original = await readFile(tar);
    const entries = tarEntrySpans(original);
    const license = entries.find((entry) => entry.path.endsWith("/LICENSE"));
    expect(license).toBeDefined();

    const traversing = Buffer.from(original);
    const traversalHeader = traversing.subarray(license!.offset, license!.offset + 512);
    traversalHeader.fill(0, 0, 100);
    traversalHeader.write(`${bundleName}/../LICENSE`, 0, "ascii");
    refreshTarChecksum(traversalHeader);
    const traversalArchive = join(fixture.root, "traversal.tar.gz");
    await writeFile(traversalArchive, normalizedGzip(traversing));
    const verifier = await loadVerifier();
    await expect(
      verifier.verifyOcctFacadeBundleWithTestRuntime(
        traversalArchive,
        fixture.trustedRuntime,
        fixture.trustedReleaseInput,
      ),
    ).rejects.toThrow(/tar entry path is unsafe/u);

    const duplicateEntry = original.subarray(
      license!.offset,
      license!.offset + license!.length,
    );
    const duplicated = Buffer.concat([
      original.subarray(0, license!.offset + license!.length),
      duplicateEntry,
      original.subarray(license!.offset + license!.length),
    ]);
    const duplicateArchive = join(fixture.root, "duplicate.tar.gz");
    await writeFile(duplicateArchive, normalizedGzip(duplicated));
    await expect(
      verifier.verifyOcctFacadeBundleWithTestRuntime(
        duplicateArchive,
        fixture.trustedRuntime,
        fixture.trustedReleaseInput,
      ),
    ).rejects.toThrow(/duplicate tar entry/u);
  });

  it("rejects non-normalized gzip, tar ownership, and tar ordering", async () => {
    const fixture = await makeFixture();
    const { archive, tar } = await makeNormalizedArchive(fixture);
    const verifier = await loadVerifier();

    const gzipMtime = Buffer.from(await readFile(archive));
    gzipMtime[4] = 1;
    const gzipMtimePath = join(fixture.root, "gzip-mtime.tar.gz");
    await writeFile(gzipMtimePath, gzipMtime);
    await expect(
      verifier.verifyOcctFacadeBundleWithTestRuntime(
        gzipMtimePath,
        fixture.trustedRuntime,
        fixture.trustedReleaseInput,
      ),
    ).rejects.toThrow(/gzip header is not normalized/u);

    const originalTar = await readFile(tar);
    const ownershipTar = Buffer.from(originalTar);
    const rootHeader = ownershipTar.subarray(0, 512);
    writeTarOctal(rootHeader, 108, 8, 1);
    refreshTarChecksum(rootHeader);
    const ownershipPath = join(fixture.root, "ownership.tar.gz");
    await writeFile(ownershipPath, normalizedGzip(ownershipTar));
    await expect(
      verifier.verifyOcctFacadeBundleWithTestRuntime(
        ownershipPath,
        fixture.trustedRuntime,
        fixture.trustedReleaseInput,
      ),
    ).rejects.toThrow(/ownership or timestamp is not normalized/u);

    const entries = tarEntrySpans(originalTar);
    const first = entries[1]!;
    const second = entries[2]!;
    const reordered = Buffer.concat([
      originalTar.subarray(0, first.offset),
      originalTar.subarray(second.offset, second.offset + second.length),
      originalTar.subarray(first.offset, first.offset + first.length),
      originalTar.subarray(second.offset + second.length),
    ]);
    const orderPath = join(fixture.root, "order.tar.gz");
    await writeFile(orderPath, normalizedGzip(reordered));
    await expect(
      verifier.verifyOcctFacadeBundleWithTestRuntime(
        orderPath,
        fixture.trustedRuntime,
        fixture.trustedReleaseInput,
      ),
    ).rejects.toThrow(/bytewise path order/u);
  });

  it("rejects an appended valid empty gzip member", async () => {
    const fixture = await makeFixture();
    const { archive } = await makeNormalizedArchive(fixture);
    const concatenated = Buffer.concat([
      await readFile(archive),
      gzipSync(Buffer.alloc(0), { level: 9 }),
    ]);
    const concatenatedPath = join(fixture.root, "concatenated.tar.gz");
    await writeFile(concatenatedPath, concatenated);
    const verifier = await loadVerifier();
    await expect(
      verifier.verifyOcctFacadeBundleWithTestRuntime(
        concatenatedPath,
        fixture.trustedRuntime,
        fixture.trustedReleaseInput,
      ),
    ).rejects.toThrow(/exactly one gzip member/u);
  });

  it("rejects hidden post-NUL ustar bytes and a directory name without its slash", async () => {
    const fixture = await makeFixture();
    const { tar } = await makeNormalizedArchive(fixture);
    const original = await readFile(tar);
    const verifier = await loadVerifier();

    const hidden = Buffer.from(original);
    const hiddenHeader = hidden.subarray(0, 512);
    hiddenHeader[99] = 0x58;
    refreshTarChecksum(hiddenHeader);
    const hiddenPath = join(fixture.root, "hidden-header.tar.gz");
    await writeFile(hiddenPath, normalizedGzip(hidden));
    await expect(
      verifier.verifyOcctFacadeBundleWithTestRuntime(
        hiddenPath,
        fixture.trustedRuntime,
        fixture.trustedReleaseInput,
      ),
    ).rejects.toThrow(/non-zero bytes after its NUL terminator/u);

    const slashless = Buffer.from(original);
    const slashlessHeader = slashless.subarray(0, 512);
    slashlessHeader.fill(0, 0, 100);
    slashlessHeader.write(bundleName, 0, "ascii");
    refreshTarChecksum(slashlessHeader);
    const slashlessPath = join(fixture.root, "slashless-directory.tar.gz");
    await writeFile(slashlessPath, normalizedGzip(slashless));
    await expect(
      verifier.verifyOcctFacadeBundleWithTestRuntime(
        slashlessPath,
        fixture.trustedRuntime,
        fixture.trustedReleaseInput,
      ),
    ).rejects.toThrow(/directory name must end/u);
  });

  it("rejects an oversized sparse archive before attempting to read it", async () => {
    const root = await mkdtemp(join(tmpdir(), "invariantcad-oversize-"));
    temporaryRoots.push(root);
    const archive = join(root, "oversized.tar.gz");
    await writeFile(archive, "");
    await truncate(archive, 512 * 1024 * 1024 + 1);
    const verifier = await loadVerifier();
    const trustedReleaseInput = await makeFixtureReleaseInput();
    await expect(
      verifier.verifyOcctFacadeBundleWithTestRuntime(
        archive,
        [],
        trustedReleaseInput,
      ),
    ).rejects.toThrow(/compressed bundle exceeds the size limit/u);
  });

  it.each([
    "source/scripts/build-occt-facade.sh",
    "metadata/provenance.json",
  ])("rejects missing required source or metadata input %s", async (path) => {
    const fixture = await makeFixture();
    await unlink(join(fixture.bundle, ...path.split("/")));
    await refreshManifest(fixture.bundle);
    await expect(verifyFixture(fixture)).rejects.toThrow(/required layout/u);
  });

  it("rejects unexpected files", async () => {
    const fixture = await makeFixture();
    const unexpectedPath = join(fixture.bundle, "unexpected.bin");
    await writeFile(unexpectedPath, "surprise");
    await chmod(unexpectedPath, 0o644);
    await refreshManifest(fixture.bundle);
    await chmod(join(fixture.bundle, "SHA256SUMS"), 0o644);
    await expect(verifyFixture(fixture)).rejects.toThrow(/unexpected unexpected\.bin/u);
  });

  it.each([
    ["metadata/sbom.cdx.json", "components"],
    ["metadata/provenance.json", "resolvedDependencies"],
  ] as const)("rejects incomplete %s metadata", async (path, field) => {
    const fixture = await makeFixture();
    const metadataPath = join(fixture.bundle, ...path.split("/"));
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    if (field === "components") metadata.components = metadata.components.slice(0, -1);
    else metadata.predicate.buildDefinition.resolvedDependencies = [];
    await writeJson(metadataPath, metadata);
    await refreshManifest(fixture.bundle);
    await expect(verifyFixture(fixture)).rejects.toThrow(/sbom|provenance/iu);
  });

  it.each([
    [
      "SBOM source URL",
      "metadata/sbom.cdx.json",
      (metadata: any) => {
        metadata.components[2].externalReferences[0].url = "https://attacker.invalid/source";
      },
    ],
    [
      "SBOM source digest",
      "metadata/sbom.cdx.json",
      (metadata: any) => {
        metadata.components[2].externalReferences[0].hashes[0].content = "0".repeat(40);
      },
    ],
    [
      "SBOM extra dependency",
      "metadata/sbom.cdx.json",
      (metadata: any) => {
        metadata.dependencies.push(structuredClone(metadata.dependencies[0]));
      },
    ],
    [
      "SBOM OCCT license exception",
      "metadata/sbom.cdx.json",
      (metadata: any) => {
        metadata.components[3].licenses = [{ expression: "LGPL-2.1-only" }];
      },
    ],
    [
      "SBOM scope disclaimer",
      "metadata/sbom.cdx.json",
      (metadata: any) => {
        metadata.metadata.component.properties =
          metadata.metadata.component.properties.filter(
            (property: any) => property.name !== "invariantcad:sbom:scope",
          );
      },
    ],
    [
      "provenance dependency URI and note smuggling",
      "metadata/provenance.json",
      (metadata: any) => {
        const dependency = metadata.predicate.buildDefinition.resolvedDependencies[0];
        dependency.uri = "git+https://attacker.invalid/source@deadbeef";
        dependency.note = "fe3d5effdaa1ca9a4007a86fde46abd62722fbba";
      },
    ],
    [
      "provenance dependency digest and note smuggling",
      "metadata/provenance.json",
      (metadata: any) => {
        const dependency = metadata.predicate.buildDefinition.resolvedDependencies[1];
        dependency.digest.sha1 = "0".repeat(40);
        dependency.note = "6e1fe656bf028bf0004482c389661587b269fc65";
      },
    ],
    [
      "provenance duplicate dependency",
      "metadata/provenance.json",
      (metadata: any) => {
        const dependencies = metadata.predicate.buildDefinition.resolvedDependencies;
        dependencies.push(structuredClone(dependencies[0]));
      },
    ],
    [
      "provenance limitations",
      "metadata/provenance.json",
      (metadata: any) => {
        metadata.predicate.limitations.statement = "Build execution was authenticated.";
        metadata.predicate.limitations.authenticated = true;
      },
    ],
  ] as const)("rejects coherently rehashed misleading %s", async (_label, path, mutate) => {
    const fixture = await makeFixture();
    const metadataPath = join(fixture.bundle, ...path.split("/"));
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    mutate(metadata);
    await writeJson(metadataPath, metadata);
    await refreshManifest(fixture.bundle);
    await expect(verifyFixture(fixture)).rejects.toThrow(
      /canonical generated JSON|does not exactly/u,
    );
  });

  it("rejects duplicate keys in coherently rehashed generated JSON", async () => {
    const fixture = await makeFixture();
    const releasePath = join(fixture.bundle, "metadata/release.json");
    const release = await readFile(releasePath, "utf8");
    await writeFile(
      releasePath,
      release.replace(
        '  "schemaVersion": 1,\n',
        '  "schemaVersion": 1,\n  "schemaVersion": 1,\n',
      ),
    );
    await refreshManifest(fixture.bundle);
    await expect(verifyFixture(fixture)).rejects.toThrow(/canonical generated JSON/u);
  });

  const runtimeDirectory = join(repoRoot, ".artifacts/occt-facade");
  const releaseInputIsCurrent = (() => {
    try {
      const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
      return descriptor.bundle?.version === bundleVersion &&
        descriptor.facade?.marker === facadeMarker &&
        descriptor.inputs?.some(
          (entry: LockedEntry) => entry.target === pipeShellPatchTarget,
        );
    } catch {
      return false;
    }
  })();
  const hasLockedRuntime = releaseInputIsCurrent &&
    existsSync(join(runtimeDirectory, "occt-wasm.js")) &&
    existsSync(join(runtimeDirectory, "occt-wasm.wasm")) &&
    existsSync(join(runtimeDirectory, "SHA256SUMS"));

  it.skipIf(!hasLockedRuntime)(
    "packages identical archives twice and verifies machine-readable archive output",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "invariantcad-bundle-repro-"));
      temporaryRoots.push(root);
      const archives: Buffer[] = [];
      for (const [index, name] of ["first", "second"].entries()) {
        const output = join(root, name);
        const packageArguments = [
          packagerPath,
          "--runtime-dir",
          runtimeDirectory,
          "--output-dir",
          output,
          "--check-reproducible",
        ];
        const hostileEnvironment = {
          ...process.env,
          TAR_OPTIONS: "--exclude=LICENSE",
          GZIP: "-1",
          POSIXLY_CORRECT: "1",
        };
        const packageResult = index === 0
          ? spawnSync(process.execPath, packageArguments, {
              encoding: "utf8",
              env: process.env,
            })
          : spawnSync(
              "bash",
              [
                "-c",
                'umask 077; exec "$@"',
                "invariantcad-umask-test",
                process.execPath,
                ...packageArguments,
              ],
              { encoding: "utf8", env: hostileEnvironment },
            );
        expect(packageResult.status, packageResult.stderr).toBe(0);
        await expectNormalizedModes(join(output, bundleName));
        const archive = join(output, `${bundleName}.tar.gz`);
        archives.push(await readFile(archive));
        const verifyResult = spawnSync(
          process.execPath,
          [verifierPath, "--json", archive],
          { encoding: "utf8" },
        );
        expect(verifyResult.status, verifyResult.stderr).toBe(0);
        expect(JSON.parse(verifyResult.stdout)).toMatchObject({
          ok: true,
          format: "tar.gz",
          bundleRoot: expect.stringContaining(`#${bundleName}`),
          archiveSha256: sha256(archives.at(-1)!),
        });
        const directoryVerify = spawnSync(
          process.execPath,
          [verifierPath, join(output, bundleName)],
          { encoding: "utf8" },
        );
        expect(directoryVerify.status, directoryVerify.stderr).toBe(0);

        if (index === 0) {
          const alternateBytes = gzipSync(gunzipSync(archives[0]!), { level: 9 });
          expect(alternateBytes.equals(archives[0]!)).toBe(false);
          const alternatePath = join(root, "alternate-recompression.tar.gz");
          await writeFile(alternatePath, alternateBytes);
          const alternateVerify = spawnSync(
            process.execPath,
            [verifierPath, alternatePath],
            { encoding: "utf8" },
          );
          expect(alternateVerify.status).toBe(1);
          expect(alternateVerify.stderr).toMatch(/trusted release archive (size|SHA-256) mismatch/u);
        }
      }
      expect(sha256(archives[0]!)).toBe(sha256(archives[1]!));
      expect(archives[0]!.equals(archives[1]!)).toBe(true);

      const modifiedOutput = join(root, "first");
      const nestedSentinel = join(modifiedOutput, bundleName, "do-not-delete.txt");
      await writeFile(nestedSentinel, "preserve modified output\n");
      const modifiedResult = spawnSync(
        process.execPath,
        [
          packagerPath,
          "--runtime-dir",
          runtimeDirectory,
          "--output-dir",
          modifiedOutput,
        ],
        { encoding: "utf8", env: process.env },
      );
      expect(modifiedResult.status).toBe(1);
      expect(modifiedResult.stderr).toMatch(
        /refusing to replace output directory with unrecognized or modified contents/u,
      );
      await expect(readFile(nestedSentinel, "utf8")).resolves.toBe(
        "preserve modified output\n",
      );

      const wrongTypeOutput = join(root, "second");
      const archivePath = join(wrongTypeOutput, `${bundleName}.tar.gz`);
      await unlink(archivePath);
      await mkdir(archivePath);
      const wrongTypeSentinel = join(archivePath, "do-not-delete.txt");
      await writeFile(wrongTypeSentinel, "preserve wrong-type output\n");
      const wrongTypeResult = spawnSync(
        process.execPath,
        [
          packagerPath,
          "--runtime-dir",
          runtimeDirectory,
          "--output-dir",
          wrongTypeOutput,
        ],
        { encoding: "utf8", env: process.env },
      );
      expect(wrongTypeResult.status).toBe(1);
      expect(wrongTypeResult.stderr).toMatch(
        /existing deterministic release archive must be a regular file/u,
      );
      await expect(readFile(wrongTypeSentinel, "utf8")).resolves.toBe(
        "preserve wrong-type output\n",
      );
    },
    60_000,
  );
});
