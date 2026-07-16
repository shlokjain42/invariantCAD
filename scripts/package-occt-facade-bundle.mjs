#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const RELEASE_INPUT_PATH = join(
  REPO_ROOT,
  "native/occt/bundle/release-input.json",
);
const DEFAULT_RUNTIME_DIR = join(REPO_ROOT, ".artifacts/occt-facade");
const DEFAULT_OUTPUT_DIR = join(REPO_ROOT, ".artifacts/occt-facade-bundle");
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9._+-]+$/u;

function usage() {
  return `Usage: node scripts/package-occt-facade-bundle.mjs [options]

Verify and package the locked InvariantCAD OCCT facade release as a
package-neutral compliance bundle.

Options:
  --runtime-dir DIR       Exact facade build directory (default:
                          .artifacts/occt-facade)
  --output-dir DIR        Transactional output directory (default:
                          .artifacts/occt-facade-bundle)
  --check-reproducible    Independently stage twice and require byte-identical
                          .tar.gz archives before publishing output
  -h, --help              Show this help

Changing --runtime-dir changes only the input location. Runtime bytes must
still match the hashes and sizes in native/occt/bundle/release-input.json.
`;
}

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  let runtimeDir = DEFAULT_RUNTIME_DIR;
  let outputDir = DEFAULT_OUTPUT_DIR;
  let checkReproducible = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--runtime-dir" || argument === "--output-dir") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        fail(`${argument} requires a directory`);
      }
      if (argument === "--runtime-dir") runtimeDir = resolve(value);
      else outputDir = resolve(value);
      index += 1;
    } else if (argument === "--check-reproducible") {
      checkReproducible = true;
    } else if (argument === "--") {
      // Accept the conventional package-runner option separator when it is
      // forwarded literally (some pnpm versions do this for nested scripts).
      continue;
    } else if (argument === "-h" || argument === "--help") {
      process.stdout.write(usage());
      return undefined;
    } else {
      fail(`unknown argument: ${argument} (use --help)`);
    }
  }

  assertSafePaths(runtimeDir, outputDir);

  return { runtimeDir, outputDir, checkReproducible };
}

function assertSafePaths(runtimeDir, outputDir) {
  if (outputDir === resolve(outputDir, sep)) {
    fail("refusing to use a filesystem root as the output directory");
  }
  if (isSameOrAncestor(outputDir, REPO_ROOT)) {
    fail("output directory may not be the repository or one of its ancestors");
  }
  const repositoryArtifacts = join(REPO_ROOT, ".artifacts");
  if (
    isSameOrAncestor(REPO_ROOT, outputDir) &&
    !isSameOrAncestor(repositoryArtifacts, outputDir)
  ) {
    fail("output directories inside the repository must stay below .artifacts");
  }
  if (
    isSameOrAncestor(outputDir, runtimeDir) ||
    isSameOrAncestor(runtimeDir, outputDir)
  ) {
    fail("runtime and output directories may not overlap");
  }
}

function isSameOrAncestor(candidateAncestor, candidateChild) {
  const childRelative = relative(candidateAncestor, candidateChild);
  return childRelative === "" || (
    !childRelative.startsWith(`..${sep}`) &&
    childRelative !== ".." &&
    !isAbsolute(childRelative)
  );
}

async function canonicalizeOutputDirectory(outputDir) {
  let existingAncestor = dirname(outputDir);
  const missingSegments = [];

  for (;;) {
    try {
      const metadata = await stat(existingAncestor);
      if (!metadata.isDirectory()) {
        fail(`output parent is not a directory: ${existingAncestor}`);
      }
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) {
        fail(`could not find an existing parent for output: ${outputDir}`);
      }
      missingSegments.unshift(basename(existingAncestor));
      existingAncestor = parent;
    }
  }

  const canonicalAncestor = await realpath(existingAncestor);
  const canonicalParent = join(canonicalAncestor, ...missingSegments);
  return join(canonicalParent, basename(outputDir));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value, label) {
  if (!isRecord(value)) fail(`${label} must be an object`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function requireInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(`${label} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function requireHash(value, label) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    fail(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function requireRelativePath(value, label) {
  requireString(value, label);
  if (
    isAbsolute(value) ||
    value.includes("\\") ||
    value.split("/").some((segment) =>
      segment === "" || segment === "." || segment === ".." ||
      !SAFE_SEGMENT_PATTERN.test(segment)
    )
  ) {
    fail(`${label} must be a normalized safe relative POSIX path`);
  }
  return value;
}

function requireExactKeys(record, keys, label) {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(`${label} must contain exactly: ${expected.join(", ")}`);
  }
}

function validateReleaseInput(raw) {
  const root = requireRecord(raw, "release input");
  requireExactKeys(
    root,
    ["schemaVersion", "bundle", "archive", "facade", "runtime", "inputs"],
    "release input",
  );
  if (root.schemaVersion !== 1) fail("unsupported release input schemaVersion");

  const bundle = requireRecord(root.bundle, "release input.bundle");
  requireExactKeys(
    bundle,
    ["name", "version", "layoutVersion", "sourceDateEpoch"],
    "release input.bundle",
  );
  const name = requireString(bundle.name, "release input.bundle.name");
  const version = requireString(bundle.version, "release input.bundle.version");
  if (!SAFE_SEGMENT_PATTERN.test(name) || !SAFE_SEGMENT_PATTERN.test(version)) {
    fail("bundle name and version must be safe archive-name segments");
  }
  const layoutVersion = requireInteger(
    bundle.layoutVersion,
    "release input.bundle.layoutVersion",
    1,
  );
  const sourceDateEpoch = requireInteger(
    bundle.sourceDateEpoch,
    "release input.bundle.sourceDateEpoch",
  );

  const archive = requireRecord(root.archive, "release input.archive");
  requireExactKeys(
    archive,
    ["format", "size", "sha256"],
    "release input.archive",
  );
  if (archive.format !== "ustar+gzip") {
    fail("release input.archive.format must be ustar+gzip");
  }
  const normalizedArchive = {
    format: archive.format,
    size: requireInteger(archive.size, "release input.archive.size", 1),
    sha256: requireHash(archive.sha256, "release input.archive.sha256"),
  };

  const facade = requireRecord(root.facade, "release input.facade");
  requireExactKeys(
    facade,
    ["marker", "abiVersion", "upstreamOcctWasmVersion"],
    "release input.facade",
  );
  const normalizedFacade = {
    marker: requireString(facade.marker, "release input.facade.marker"),
    abiVersion: requireString(
      facade.abiVersion,
      "release input.facade.abiVersion",
    ),
    upstreamOcctWasmVersion: requireString(
      facade.upstreamOcctWasmVersion,
      "release input.facade.upstreamOcctWasmVersion",
    ),
  };

  if (!Array.isArray(root.runtime) || root.runtime.length !== 2) {
    fail("release input.runtime must contain exactly the JavaScript and WebAssembly files");
  }
  const runtime = root.runtime.map((rawEntry, index) => {
    const label = `release input.runtime[${index}]`;
    const entry = requireRecord(rawEntry, label);
    requireExactKeys(
      entry,
      ["source", "target", "mediaType", "size", "sha256"],
      label,
    );
    return {
      source: requireRelativePath(entry.source, `${label}.source`),
      target: requireRelativePath(entry.target, `${label}.target`),
      mediaType: requireString(entry.mediaType, `${label}.mediaType`),
      size: requireInteger(entry.size, `${label}.size`, 1),
      sha256: requireHash(entry.sha256, `${label}.sha256`),
    };
  });
  const expectedRuntimeSources = ["occt-wasm.js", "occt-wasm.wasm"];
  if (runtime.some((entry, index) => entry.source !== expectedRuntimeSources[index])) {
    fail("release input.runtime must list occt-wasm.js then occt-wasm.wasm");
  }

  if (!Array.isArray(root.inputs) || root.inputs.length === 0) {
    fail("release input.inputs must be a non-empty array");
  }
  const inputs = root.inputs.map((rawEntry, index) => {
    const label = `release input.inputs[${index}]`;
    const entry = requireRecord(rawEntry, label);
    requireExactKeys(
      entry,
      ["source", "target", "role", "mode", "size", "sha256"],
      label,
    );
    const mode = requireString(entry.mode, `${label}.mode`);
    if (mode !== "0644" && mode !== "0755") {
      fail(`${label}.mode must be 0644 or 0755`);
    }
    return {
      source: requireRelativePath(entry.source, `${label}.source`),
      target: requireRelativePath(entry.target, `${label}.target`),
      role: requireString(entry.role, `${label}.role`),
      mode,
      size: requireInteger(entry.size, `${label}.size`, 1),
      sha256: requireHash(entry.sha256, `${label}.sha256`),
    };
  });

  const targets = [...runtime, ...inputs].map((entry) => entry.target);
  if (new Set(targets).size !== targets.length) {
    fail("release input contains duplicate bundle target paths");
  }

  return {
    schemaVersion: 1,
    bundle: { name, version, layoutVersion, sourceDateEpoch },
    archive: normalizedArchive,
    facade: normalizedFacade,
    runtime,
    inputs,
  };
}

async function sha256File(path) {
  const handle = await open(path, "r");
  const hash = createHash("sha256");
  try {
    for await (const chunk of handle.readableWebStream()) hash.update(chunk);
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function assertOrdinaryFile(path, label) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") fail(`${label} not found: ${path}`);
    throw error;
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    fail(`${label} must be a regular file, not a symlink: ${path}`);
  }
  return metadata;
}

async function validateFile(path, expected, label) {
  const metadata = await assertOrdinaryFile(path, label);
  if (metadata.size !== expected.size) {
    fail(`${label} size is ${metadata.size}; expected ${expected.size}: ${path}`);
  }
  const digest = await sha256File(path);
  if (digest !== expected.sha256) {
    fail(`${label} SHA-256 is ${digest}; expected ${expected.sha256}: ${path}`);
  }
}

function parseRuntimeManifest(contents) {
  if (!contents.endsWith("\n") || contents.includes("\r")) {
    fail("runtime SHA256SUMS must use LF lines and end with a newline");
  }
  const result = new Map();
  const lines = contents.slice(0, -1).split("\n");
  for (const [index, line] of lines.entries()) {
    const match = /^([0-9a-f]{64})  ([A-Za-z0-9._+-]+)$/u.exec(line);
    if (match === null) {
      fail(`runtime SHA256SUMS line ${index + 1} is malformed`);
    }
    const [, digest, name] = match;
    if (result.has(name)) fail(`runtime SHA256SUMS repeats ${name}`);
    result.set(name, digest);
  }
  return result;
}

async function validateRuntimeDirectory(runtimeDir, releaseInput) {
  let runtimeMetadata;
  try {
    runtimeMetadata = await lstat(runtimeDir);
  } catch (error) {
    if (error?.code === "ENOENT") fail(`runtime directory not found: ${runtimeDir}`);
    throw error;
  }
  if (runtimeMetadata.isSymbolicLink() || !runtimeMetadata.isDirectory()) {
    fail(`runtime directory must be a real directory, not a symlink: ${runtimeDir}`);
  }

  const allowed = new Set([
    ...releaseInput.runtime.map((entry) => entry.source),
    "SHA256SUMS",
  ]);
  const entries = await readdir(runtimeDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!allowed.has(entry.name) || !entry.isFile() || entry.isSymbolicLink()) {
      fail(`unexpected runtime directory entry: ${join(runtimeDir, entry.name)}`);
    }
  }
  if (entries.length !== allowed.size) {
    fail("runtime directory must contain exactly occt-wasm.js, occt-wasm.wasm, and SHA256SUMS");
  }

  const manifestPath = join(runtimeDir, "SHA256SUMS");
  await assertOrdinaryFile(manifestPath, "runtime SHA256SUMS");
  const manifest = parseRuntimeManifest(await readFile(manifestPath, "utf8"));
  if (manifest.size !== releaseInput.runtime.length) {
    fail("runtime SHA256SUMS must contain exactly the two locked runtime entries");
  }

  for (const entry of releaseInput.runtime) {
    const declaredDigest = manifest.get(entry.source);
    if (declaredDigest !== entry.sha256) {
      fail(
        `runtime SHA256SUMS declares ${declaredDigest ?? "no digest"} for ${entry.source}; expected ${entry.sha256}`,
      );
    }
    await validateFile(
      join(runtimeDir, entry.source),
      entry,
      `runtime file ${entry.source}`,
    );
  }
}

async function validateRepositoryInputs(releaseInput) {
  for (const entry of releaseInput.inputs) {
    await validateFile(
      join(REPO_ROOT, entry.source),
      entry,
      `locked ${entry.role}`,
    );
  }
}

async function readUpstreamLock() {
  const raw = JSON.parse(
    await readFile(join(REPO_ROOT, "native/occt/upstream.lock.json"), "utf8"),
  );
  const lock = requireRecord(raw, "upstream lock");
  if (lock.schemaVersion !== 1) fail("unsupported upstream lock schemaVersion");
  return lock;
}

function runtimeReleaseRecords(releaseInput) {
  return releaseInput.runtime.map(({ target, mediaType, size, sha256 }) => ({
    path: target,
    mediaType,
    size,
    sha256,
  }));
}

function sourceMaterialRecords(releaseInput) {
  return releaseInput.inputs
    .filter((entry) => entry.target.startsWith("source/"))
    .map(({ target, role, size, sha256 }) => ({ path: target, role, size, sha256 }));
}

function makeReleaseMetadata(releaseInput) {
  const patchEntries = releaseInput.inputs
    .filter((entry) => entry.role === "source-patch")
    .map(({ target, size, sha256 }) => ({ path: target, size, sha256 }));
  return {
    schemaVersion: 1,
    bundle: {
      name: releaseInput.bundle.name,
      version: releaseInput.bundle.version,
      layoutVersion: releaseInput.bundle.layoutVersion,
    },
    facade: releaseInput.facade,
    runtime: runtimeReleaseRecords(releaseInput),
    source: {
      lockPath: "source/native/occt/upstream.lock.json",
      buildScriptPath: "source/scripts/build-occt-facade.sh",
      patches: patchEntries,
      relinkInstructionsPath: "SOURCE_AND_RELINK.md",
      materials: sourceMaterialRecords(releaseInput),
    },
    integrity: {
      algorithm: "SHA-256",
      manifestPath: "SHA256SUMS",
      coverage: "all regular bundle files except SHA256SUMS",
    },
  };
}

function makeSbom(releaseInput, lock) {
  const bundleRef = `${releaseInput.bundle.name}@${releaseInput.bundle.version}`;
  const facadeRef = `pkg:generic/${releaseInput.bundle.name}@${releaseInput.bundle.version}`;
  const occtWasmRef = `pkg:generic/occt-wasm@${releaseInput.facade.upstreamOcctWasmVersion}`;
  const occtRef = `pkg:generic/opencascade-technology@${lock.occt.commit}`;
  const builderDigest = lock.builder.digest.replace(/^sha256:/u, "");
  const runtimeComponents = releaseInput.runtime.map((entry) => ({
    type: "file",
    "bom-ref": `file:${entry.target}`,
    name: entry.target.split("/").at(-1),
    version: releaseInput.bundle.version,
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
        name: releaseInput.bundle.name,
        version: releaseInput.bundle.version,
        licenses: [{ license: { id: "Apache-2.0" } }],
        properties: [
          { name: "invariantcad:facade:marker", value: releaseInput.facade.marker },
          {
            name: "invariantcad:sbom:scope",
            value: "Package-neutral component inventory; not a legal-compliance determination.",
          },
          { name: "invariantcad:bundle:identity", value: bundleRef },
        ],
      },
    },
    components: [
      ...runtimeComponents,
      {
        type: "library",
        "bom-ref": occtWasmRef,
        name: "occt-wasm",
        version: releaseInput.facade.upstreamOcctWasmVersion,
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
        licenses: [
          { expression: "LGPL-2.1-only WITH OCCT-exception-1.0" },
        ],
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
        "bom-ref": `oci:${lock.builder.image}@${lock.builder.digest}`,
        name: lock.builder.image,
        version: lock.builder.digest,
        scope: "excluded",
        hashes: [{ alg: "SHA-256", content: builderDigest }],
        properties: [
          { name: "invariantcad:component:role", value: "build-environment" },
          { name: "invariantcad:builder:platform", value: lock.builder.platform },
        ],
      },
    ],
    dependencies: [
      {
        ref: facadeRef,
        dependsOn: runtimeComponents.map((component) => component["bom-ref"]),
      },
      {
        ref: "file:runtime/occt-wasm.js",
        dependsOn: [occtWasmRef],
      },
      {
        ref: "file:runtime/occt-wasm.wasm",
        dependsOn: [occtWasmRef, occtRef],
      },
      { ref: occtWasmRef, dependsOn: [occtRef] },
      { ref: occtRef, dependsOn: [] },
    ],
  };
}

function makeProvenance(releaseInput, lock) {
  const patchMaterials = releaseInput.inputs
    .filter((entry) => entry.role === "source-patch")
    .map((entry) => ({
      uri: `file:${entry.target}`,
      digest: { sha256: entry.sha256 },
    }));
  const builderDigest = lock.builder.digest.replace(/^sha256:/u, "");
  const recipeMaterials = releaseInput.inputs
    .filter((entry) => entry.target.startsWith("source/"))
    .map((entry) => ({
      uri: `file:${entry.target}`,
      digest: { sha256: entry.sha256 },
    }));

  return {
    _type: "https://in-toto.io/Statement/v1",
    subject: releaseInput.runtime.map((entry) => ({
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
          facadeMarker: releaseInput.facade.marker,
          patchOrder: patchMaterials.map((material) => material.uri.slice("file:".length)),
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
            digest: { sha256: builderDigest },
          },
          ...recipeMaterials,
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

async function copyLockedFile(source, target, mode, expected, label) {
  await mkdir(dirname(target), { recursive: true, mode: 0o755 });
  await copyFile(source, target, fsConstants.COPYFILE_EXCL);
  await chmod(target, Number.parseInt(mode, 8));
  // Recheck the staged bytes rather than relying on the earlier input check;
  // this closes the validation/copy gap if an input changes during packaging.
  await validateFile(target, expected, `staged ${label}`);
}

function stableJson(value) {
  return `${JSON.stringify(value, undefined, 2)}\n`;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  await writeFile(path, stableJson(value), { encoding: "utf8", mode: 0o644, flag: "wx" });
}

function compareBytewise(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function listRegularFiles(root, directory = root) {
  const names = (await readdir(directory)).sort(compareBytewise);
  const files = [];
  for (const name of names) {
    const path = join(directory, name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) fail(`bundle staging contains a symlink: ${path}`);
    if (metadata.isDirectory()) files.push(...await listRegularFiles(root, path));
    else if (metadata.isFile()) files.push(relative(root, path).split(sep).join("/"));
    else fail(`bundle staging contains a non-regular entry: ${path}`);
  }
  return files;
}

async function writeManifest(bundleRoot) {
  const paths = (await listRegularFiles(bundleRoot))
    .filter((path) => path !== "SHA256SUMS")
    .sort(compareBytewise);
  const lines = [];
  for (const path of paths) {
    lines.push(`${await sha256File(join(bundleRoot, ...path.split("/")))}  ${path}`);
  }
  await writeFile(join(bundleRoot, "SHA256SUMS"), `${lines.join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o644,
    flag: "wx",
  });
}

async function normalizeTree(root, epochSeconds) {
  const epoch = new Date(epochSeconds * 1000);
  async function visit(path) {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        await visit(child);
        await chmod(child, 0o755);
      } else if (entry.isFile()) {
        const metadata = await lstat(child);
        await chmod(child, (metadata.mode & 0o111) === 0 ? 0o644 : 0o755);
      } else {
        fail(`cannot normalize non-regular bundle entry: ${child}`);
      }
      await utimes(child, epoch, epoch);
    }
  }
  await visit(root);
  await chmod(root, 0o755);
  await utimes(root, epoch, epoch);
}

function deterministicToolEnvironment() {
  const environment = {
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
  };
  if (process.env.PATH !== undefined) environment.PATH = process.env.PATH;
  return environment;
}

function requireTool(command, expectedPrefix) {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    env: deterministicToolEnvironment(),
  });
  if (result.error?.code === "ENOENT") fail(`required command not found: ${command}`);
  if (result.status !== 0) fail(`could not inspect required command: ${command}`);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (!output.startsWith(expectedPrefix)) {
    fail(`${command} must be ${expectedPrefix.trim()}, got: ${output.split("\n")[0]}`);
  }
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: options.encoding ?? "utf8",
    stdio: options.stdio,
    maxBuffer: 8 * 1024 * 1024,
    // Do not inherit TAR_OPTIONS, GZIP, POSIXLY_CORRECT, or similar option
    // injection. Explicit argv plus this minimal environment define the
    // archive bytes.
    env: deterministicToolEnvironment(),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    fail(`${command} failed${stderr === "" ? "" : `: ${stderr}`}`);
  }
}

async function createArchive(candidateRoot, directoryName, epochSeconds) {
  const tarPath = join(candidateRoot, `.${directoryName}.tar`);
  const archivePath = join(candidateRoot, `${directoryName}.tar.gz`);
  runCommand("tar", [
    "--format=ustar",
    "--sort=name",
    `--mtime=@${epochSeconds}`,
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    "--mode=u+rwX,go+rX,go-w",
    "-cf",
    tarPath,
    "-C",
    candidateRoot,
    "--",
    directoryName,
  ]);

  const archiveHandle = await open(archivePath, "wx", 0o644);
  try {
    runCommand("gzip", ["-n", "-9", "-c", tarPath], {
      stdio: ["ignore", archiveHandle.fd, "pipe"],
      encoding: undefined,
    });
  } finally {
    await archiveHandle.close();
    await rm(tarPath, { force: true });
  }
  await chmod(archivePath, 0o644);
  const epoch = new Date(epochSeconds * 1000);
  await utimes(archivePath, epoch, epoch);
  return archivePath;
}

async function buildCandidate(
  candidateRoot,
  releaseInput,
  upstreamLock,
  runtimeDir,
) {
  const directoryName = `${releaseInput.bundle.name}-${releaseInput.bundle.version}`;
  const bundleRoot = join(candidateRoot, directoryName);
  await mkdir(bundleRoot, { recursive: true, mode: 0o755 });

  for (const entry of releaseInput.runtime) {
    await copyLockedFile(
      join(runtimeDir, entry.source),
      join(bundleRoot, ...entry.target.split("/")),
      "0644",
      entry,
      `runtime file ${entry.source}`,
    );
  }
  for (const entry of releaseInput.inputs) {
    await copyLockedFile(
      join(REPO_ROOT, entry.source),
      join(bundleRoot, ...entry.target.split("/")),
      entry.mode,
      entry,
      entry.role,
    );
  }

  await writeJson(
    join(bundleRoot, "metadata/release.json"),
    makeReleaseMetadata(releaseInput),
  );
  await writeJson(
    join(bundleRoot, "metadata/sbom.cdx.json"),
    makeSbom(releaseInput, upstreamLock),
  );
  await writeJson(
    join(bundleRoot, "metadata/provenance.json"),
    makeProvenance(releaseInput, upstreamLock),
  );
  await writeManifest(bundleRoot);
  await normalizeTree(bundleRoot, releaseInput.bundle.sourceDateEpoch);
  const archivePath = await createArchive(
    candidateRoot,
    directoryName,
    releaseInput.bundle.sourceDateEpoch,
  );
  await validateFile(
    archivePath,
    releaseInput.archive,
    "deterministic release archive",
  );
  await chmod(candidateRoot, 0o755);
  const epoch = new Date(releaseInput.bundle.sourceDateEpoch * 1000);
  await utimes(candidateRoot, epoch, epoch);
  return { directoryName, bundleRoot, archivePath };
}

async function filesEqual(leftPath, rightPath) {
  const [leftStat, rightStat] = await Promise.all([stat(leftPath), stat(rightPath)]);
  if (leftStat.size !== rightStat.size) return false;
  const [leftDigest, rightDigest] = await Promise.all([
    sha256File(leftPath),
    sha256File(rightPath),
  ]);
  if (leftDigest !== rightDigest) return false;
  const [left, right] = await Promise.all([readFile(leftPath), readFile(rightPath)]);
  return left.equals(right);
}

async function treesEqual(leftPath, rightPath) {
  const [leftMetadata, rightMetadata] = await Promise.all([
    lstat(leftPath),
    lstat(rightPath),
  ]);
  if (leftMetadata.isSymbolicLink() || rightMetadata.isSymbolicLink()) return false;
  if ((leftMetadata.mode & 0o777) !== (rightMetadata.mode & 0o777)) return false;

  if (leftMetadata.isDirectory() && rightMetadata.isDirectory()) {
    const [leftNames, rightNames] = await Promise.all([
      readdir(leftPath),
      readdir(rightPath),
    ]);
    leftNames.sort(compareBytewise);
    rightNames.sort(compareBytewise);
    if (
      leftNames.length !== rightNames.length ||
      leftNames.some((name, index) => name !== rightNames[index])
    ) {
      return false;
    }
    for (const name of leftNames) {
      if (!await treesEqual(join(leftPath, name), join(rightPath, name))) {
        return false;
      }
    }
    return true;
  }

  if (leftMetadata.isFile() && rightMetadata.isFile()) {
    return filesEqual(leftPath, rightPath);
  }
  return false;
}

async function publishCandidate(
  candidateRoot,
  outputDir,
  releaseInput,
  directoryName,
) {
  let outputMetadata;
  try {
    outputMetadata = await lstat(outputDir);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (outputMetadata?.isSymbolicLink()) {
    fail(`refusing to replace symlink output directory: ${outputDir}`);
  }
  if (outputMetadata !== undefined && !outputMetadata.isDirectory()) {
    fail(`refusing to replace non-directory output: ${outputDir}`);
  }
  if (outputMetadata !== undefined) {
    const existingEntries = (await readdir(outputDir)).sort(compareBytewise);
    let replaceable = existingEntries.length === 0;
    if (!replaceable) {
      const expectedEntries = [directoryName, `${directoryName}.tar.gz`]
        .sort(compareBytewise);
      const hasExactNames = existingEntries.length === expectedEntries.length &&
        existingEntries.every((entry, index) => entry === expectedEntries[index]);
      if (hasExactNames) {
        const existingBundle = join(outputDir, directoryName);
        const existingBundleMetadata = await lstat(existingBundle);
        if (
          existingBundleMetadata.isSymbolicLink() ||
          !existingBundleMetadata.isDirectory()
        ) {
          fail(`existing bundle root is not a real directory: ${existingBundle}`);
        }
        await validateFile(
          join(outputDir, `${directoryName}.tar.gz`),
          releaseInput.archive,
          "existing deterministic release archive",
        );
        replaceable = await treesEqual(candidateRoot, outputDir);
      }
    }
    if (!replaceable) {
      fail(
        `refusing to replace output directory with unrecognized or modified contents: ${outputDir}`,
      );
    }
  }

  let backup;
  let movedExisting = false;
  let committed = false;
  try {
    if (outputMetadata !== undefined) {
      backup = await mkdtemp(
        join(dirname(outputDir), `.${basename(outputDir)}.previous-`),
      );
      await rm(backup, { recursive: true });
      await rename(outputDir, backup);
      movedExisting = true;
    }
    await rename(candidateRoot, outputDir);
    committed = true;
  } catch (error) {
    if (movedExisting && !committed) {
      try {
        await rename(backup, outputDir);
      } catch (restoreError) {
        error.message += `; additionally failed to restore previous output: ${restoreError.message}`;
      }
    }
    throw error;
  }

  if (movedExisting) {
    try {
      await rm(backup, { recursive: true });
    } catch (error) {
      process.stderr.write(
        `[occt-facade-bundle] warning: output committed but previous-output cleanup failed: ${error.message}\n`,
      );
    }
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options === undefined) return;

  requireTool("tar", "tar (GNU tar)");
  requireTool("gzip", "gzip ");

  const releaseInput = validateReleaseInput(
    JSON.parse(await readFile(RELEASE_INPUT_PATH, "utf8")),
  );
  await Promise.all([
    validateRuntimeDirectory(options.runtimeDir, releaseInput),
    validateRepositoryInputs(releaseInput),
  ]);
  const upstreamLock = await readUpstreamLock();

  const runtimeDir = await realpath(options.runtimeDir);
  let outputDir = await canonicalizeOutputDirectory(options.outputDir);
  assertSafePaths(runtimeDir, outputDir);

  let outputParent = dirname(outputDir);
  await mkdir(outputParent, { recursive: true, mode: 0o755 });
  outputParent = await realpath(outputParent);
  outputDir = join(outputParent, basename(outputDir));
  assertSafePaths(runtimeDir, outputDir);
  const prefix = join(outputParent, `.${releaseInput.bundle.name}.stage-`);
  const primaryRoot = await mkdtemp(prefix);
  let secondaryRoot;
  let published = false;

  try {
    const primary = await buildCandidate(
      primaryRoot,
      releaseInput,
      upstreamLock,
      runtimeDir,
    );

    if (options.checkReproducible) {
      secondaryRoot = await mkdtemp(prefix);
      const secondary = await buildCandidate(
        secondaryRoot,
        releaseInput,
        upstreamLock,
        runtimeDir,
      );
      if (!await filesEqual(primary.archivePath, secondary.archivePath)) {
        fail("independent bundle builds produced different archive bytes");
      }
      process.stderr.write(
        `[occt-facade-bundle] reproducibility check passed: ${await sha256File(primary.archivePath)}\n`,
      );
    }

    const archiveDigest = await sha256File(primary.archivePath);
    await publishCandidate(
      primaryRoot,
      outputDir,
      releaseInput,
      primary.directoryName,
    );
    published = true;
    process.stderr.write(
      `[occt-facade-bundle] wrote ${join(outputDir, primary.directoryName)}\n` +
      `[occt-facade-bundle] wrote ${join(outputDir, `${primary.directoryName}.tar.gz`)}\n` +
      `[occt-facade-bundle] archive sha256 ${archiveDigest}\n`,
    );
  } finally {
    if (!published) await rm(primaryRoot, { recursive: true, force: true });
    if (secondaryRoot !== undefined) {
      await rm(secondaryRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  process.stderr.write(`[occt-facade-bundle] error: ${error.message}\n`);
  process.exitCode = 1;
});
