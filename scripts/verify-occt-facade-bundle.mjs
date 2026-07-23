#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const BUNDLE_NAME = "invariantcad-occt-facade";
const BUNDLE_VERSION = "0.9.0";
const BUNDLE_DIRECTORY = `${BUNDLE_NAME}-${BUNDLE_VERSION}`;
const FACADE_MARKER =
  "invariantcad-facade@0.9.0+occt-wasm.3.7.0";
const DRAFT_FACADE_MARKER =
  "invariantcad-facade@0.2.0+occt-wasm.3.7.0";
const CONTROLLED_PIPE_SHELL_FACADE_MARKER =
  "invariantcad-facade@0.3.0+occt-wasm.3.7.0";
const BOOLEAN_FACADE_MARKER =
  "invariantcad-facade@0.4.0+occt-wasm.3.7.0";
const EDGE_TREATMENT_FACADE_MARKER =
  "invariantcad-facade@0.5.0+occt-wasm.3.7.0";
const SOLID_OFFSET_FACADE_MARKER =
  "invariantcad-facade@0.6.0+occt-wasm.3.7.0";
const BOUNDED_ARTIFACT_FACADE_MARKER =
  "invariantcad-facade@0.7.0+occt-wasm.3.7.0";
const HARDENED_ARTIFACT_FACADE_MARKER =
  "invariantcad-facade@0.8.0+occt-wasm.3.7.0";
const UPSTREAM_OCCT_WASM_VERSION = "3.7.0";
const RELEASE_INPUT_URL = new URL(
  "../native/occt/bundle/release-input.json",
  import.meta.url,
);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_FILE_BYTES = 256 * 1024 * 1024;

const RUNTIME_PATHS = Object.freeze([
  "runtime/occt-wasm.js",
  "runtime/occt-wasm.wasm",
]);
const PATCH_PATHS = Object.freeze([
  "source/native/occt/patches/0001-atomic-multi-face-draft.patch",
  "source/native/occt/patches/0002-indexed-draft-history.patch",
  "source/native/occt/patches/0003-controlled-pipe-shell.patch",
  "source/native/occt/patches/0004-exact-boolean-history.patch",
  "source/native/occt/patches/0005-exact-edge-treatment-history.patch",
  "source/native/occt/patches/0006-exact-solid-offset-history.patch",
  "source/native/occt/patches/0007-bounded-shape-artifacts.patch",
  "source/native/occt/patches/0008-hardened-shape-artifact-budgets.patch",
  "source/native/occt/patches/0009-bintools-v4-structural-preflight.patch",
]);
const LICENSE_PATHS = Object.freeze([
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "licenses/LGPL-2.1.txt",
  "licenses/OCCT_LGPL_EXCEPTION.txt",
  "licenses/occt-wasm-MIT.txt",
]);
const SOURCE_PATHS = Object.freeze([
  "source/native/occt/upstream.lock.json",
  ...PATCH_PATHS,
  "source/scripts/build-occt-facade.sh",
  "SOURCE_AND_RELINK.md",
]);
const METADATA_PATHS = Object.freeze([
  "metadata/release.json",
  "metadata/sbom.cdx.json",
  "metadata/provenance.json",
]);
const EXPECTED_PAYLOAD_PATHS = Object.freeze(
  [...RUNTIME_PATHS, ...METADATA_PATHS, ...SOURCE_PATHS, ...LICENSE_PATHS].sort(),
);
const EXPECTED_FILE_PATHS = Object.freeze(
  [...EXPECTED_PAYLOAD_PATHS, "SHA256SUMS"].sort(),
);
const EXPECTED_DIRECTORIES = Object.freeze(
  [...new Set(EXPECTED_FILE_PATHS.flatMap(parentDirectories))].sort(),
);

export class OcctFacadeBundleVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = "OcctFacadeBundleVerificationError";
  }
}

function fail(message) {
  throw new OcctFacadeBundleVerificationError(message);
}

function parentDirectories(path) {
  const parts = path.split("/");
  const parents = [];
  for (let index = 1; index < parts.length; index += 1) {
    parents.push(parts.slice(0, index).join("/"));
  }
  return parents;
}

function compareBytewise(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}

function assertNormalizedMode(stat, expectedMode, description) {
  const mode = stat.mode & 0o7777;
  if (mode !== expectedMode) {
    fail(`${description} mode is ${mode.toString(8)}; expected ${expectedMode.toString(8)}`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const CRC32_TABLE = Object.freeze(
  Array.from({ length: 256 }, (_, value) => {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    return crc >>> 0;
  }),
);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeUtf8(bytes, description) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(`${description} is not valid UTF-8`);
  }
}

function assertSafeRelativePath(path, description = "path") {
  if (typeof path !== "string" || path.length === 0) {
    fail(`${description} must be a non-empty string`);
  }
  if (
    path.includes("\0") ||
    path.includes("\\") ||
    path.includes("\r") ||
    path.includes("\n") ||
    path.startsWith("/") ||
    isAbsolute(path)
  ) {
    fail(`${description} is unsafe: ${JSON.stringify(path)}`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail(`${description} is unsafe: ${JSON.stringify(path)}`);
  }
  return path;
}

function assertExactSet(actual, expected, description) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((item) => !actualSet.has(item));
  const extra = actual.filter((item) => !expectedSet.has(item));
  if (missing.length > 0 || extra.length > 0 || actual.length !== actualSet.size) {
    const details = [];
    if (missing.length > 0) details.push(`missing ${missing.join(", ")}`);
    if (extra.length > 0) details.push(`unexpected ${extra.join(", ")}`);
    if (actual.length !== actualSet.size) details.push("duplicate entries");
    fail(`${description} does not match the required layout (${details.join("; ")})`);
  }
}

function assertExactKeys(record, expected, description) {
  assertExactSet(Object.keys(record), expected, `${description} keys`);
}

function asObject(value, description) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${description} must be an object`);
  }
  return value;
}

function asArray(value, description) {
  if (!Array.isArray(value)) fail(`${description} must be an array`);
  return value;
}

function asString(value, description) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${description} must be a non-empty string`);
  }
  return value;
}

function asInteger(value, description) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${description} must be a non-negative safe integer`);
  }
  return value;
}

function assertSha256(value, description) {
  const digest = asString(value, description);
  if (!SHA256_PATTERN.test(digest)) {
    fail(`${description} must be a lowercase SHA-256 digest`);
  }
  return digest;
}

function parseJsonFile(files, path) {
  const bytes = files.get(path);
  if (bytes === undefined) fail(`${path} is missing`);
  try {
    return JSON.parse(decodeUtf8(bytes, path));
  } catch (error) {
    if (error instanceof OcctFacadeBundleVerificationError) throw error;
    fail(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertCanonicalGeneratedJson(files, path, expected) {
  const actual = files.get(path);
  if (actual === undefined) fail(`${path} is missing`);
  const canonical = Buffer.from(`${JSON.stringify(expected, undefined, 2)}\n`, "utf8");
  if (!actual.equals(canonical)) {
    fail(`${path} is not the exact canonical generated JSON for the trusted release`);
  }
}

function validateReleaseInput(raw) {
  const root = asObject(raw, "trusted release input");
  assertExactKeys(
    root,
    ["schemaVersion", "bundle", "archive", "facade", "runtime", "inputs"],
    "trusted release input",
  );
  if (root.schemaVersion !== 1) fail("trusted release input schemaVersion must be 1");
  const bundle = asObject(root.bundle, "trusted release input.bundle");
  assertExactKeys(bundle, ["name", "version", "layoutVersion", "sourceDateEpoch"], "trusted release input.bundle");
  if (
    bundle.name !== BUNDLE_NAME ||
    bundle.version !== BUNDLE_VERSION ||
    bundle.layoutVersion !== 1 ||
    bundle.sourceDateEpoch !== 0
  ) {
    fail("trusted release input has an unknown bundle identity or layout");
  }
  const archive = asObject(root.archive, "trusted release input.archive");
  assertExactKeys(
    archive,
    ["format", "size", "sha256"],
    "trusted release input.archive",
  );
  if (archive.format !== "ustar+gzip") {
    fail('trusted release input.archive.format must be "ustar+gzip"');
  }
  const normalizedArchive = {
    format: archive.format,
    size: asInteger(archive.size, "trusted release input.archive.size"),
    sha256: assertSha256(
      archive.sha256,
      "trusted release input.archive.sha256",
    ),
  };
  if (normalizedArchive.size === 0) {
    fail("trusted release input.archive.size must be positive");
  }
  const facade = asObject(root.facade, "trusted release input.facade");
  assertExactKeys(facade, ["marker", "abiVersion", "upstreamOcctWasmVersion"], "trusted release input.facade");
  if (
    facade.marker !== FACADE_MARKER ||
    facade.abiVersion !== BUNDLE_VERSION ||
    facade.upstreamOcctWasmVersion !== UPSTREAM_OCCT_WASM_VERSION
  ) {
    fail("trusted release input has an unknown facade ABI");
  }

  const runtime = asArray(root.runtime, "trusted release input.runtime").map((rawEntry, index) => {
    const entry = asObject(rawEntry, `trusted release input.runtime[${index}]`);
    assertExactKeys(entry, ["source", "target", "mediaType", "size", "sha256"], `trusted release input.runtime[${index}]`);
    return {
      source: assertSafeRelativePath(entry.source, `trusted release input.runtime[${index}].source`),
      target: assertSafeRelativePath(entry.target, `trusted release input.runtime[${index}].target`),
      mediaType: asString(entry.mediaType, `trusted release input.runtime[${index}].mediaType`),
      size: asInteger(entry.size, `trusted release input.runtime[${index}].size`),
      sha256: assertSha256(entry.sha256, `trusted release input.runtime[${index}].sha256`),
    };
  });
  assertExactSet(runtime.map((entry) => entry.target), RUNTIME_PATHS, "trusted runtime targets");
  const inputs = asArray(root.inputs, "trusted release input.inputs").map((rawEntry, index) => {
    const entry = asObject(rawEntry, `trusted release input.inputs[${index}]`);
    assertExactKeys(entry, ["source", "target", "role", "mode", "size", "sha256"], `trusted release input.inputs[${index}]`);
    if (entry.mode !== "0644" && entry.mode !== "0755") {
      fail(`trusted release input.inputs[${index}].mode must be 0644 or 0755`);
    }
    return {
      source: assertSafeRelativePath(entry.source, `trusted release input.inputs[${index}].source`),
      target: assertSafeRelativePath(entry.target, `trusted release input.inputs[${index}].target`),
      role: asString(entry.role, `trusted release input.inputs[${index}].role`),
      mode: entry.mode,
      size: asInteger(entry.size, `trusted release input.inputs[${index}].size`),
      sha256: assertSha256(entry.sha256, `trusted release input.inputs[${index}].sha256`),
    };
  });
  assertExactSet(inputs.map((entry) => entry.target), [...SOURCE_PATHS, ...LICENSE_PATHS], "trusted copied input targets");
  const allTargets = [...runtime, ...inputs].map((entry) => entry.target);
  if (new Set(allTargets).size !== allTargets.length) fail("trusted release input contains duplicate targets");
  return { bundle, archive: normalizedArchive, facade, runtime, inputs };
}

async function readTrustedReleaseInput() {
  let raw;
  try {
    raw = JSON.parse(await readFile(RELEASE_INPUT_URL, "utf8"));
  } catch (error) {
    fail(`trusted release input cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateReleaseInput(raw);
}

function verifyPinnedPayload(files, releaseInput, trustedRuntimeOverride) {
  let runtimePins = releaseInput.runtime;
  if (trustedRuntimeOverride !== undefined) {
    runtimePins = asArray(trustedRuntimeOverride, "trustedRuntime override").map((rawEntry, index) => {
      const entry = asObject(rawEntry, `trustedRuntime[${index}]`);
      assertExactKeys(entry, ["path", "size", "sha256"], `trustedRuntime[${index}]`);
      return {
        source: entry.path.split("/").at(-1),
        target: assertSafeRelativePath(entry.path, `trustedRuntime[${index}].path`),
        mediaType: entry.path.endsWith(".wasm") ? "application/wasm" : "text/javascript",
        size: asInteger(entry.size, `trustedRuntime[${index}].size`),
        sha256: assertSha256(entry.sha256, `trustedRuntime[${index}].sha256`),
      };
    });
    assertExactSet(runtimePins.map((entry) => entry.target), RUNTIME_PATHS, "trustedRuntime override paths");
  }
  for (const entry of [...runtimePins, ...releaseInput.inputs]) {
    const bytes = files.get(entry.target);
    if (bytes === undefined) fail(`trusted release payload is missing: ${entry.target}`);
    if (bytes.length !== entry.size) {
      fail(`trusted release size mismatch for ${entry.target}: expected ${entry.size}, got ${bytes.length}`);
    }
    const actual = sha256(bytes);
    if (actual !== entry.sha256) {
      fail(`trusted release SHA-256 mismatch for ${entry.target}: expected ${entry.sha256}, got ${actual}`);
    }
  }
  return runtimePins;
}

async function collectDirectory(inputPath) {
  const rootPath = resolve(inputPath);
  let rootStat;
  try {
    rootStat = await lstat(rootPath);
  } catch (error) {
    fail(`bundle path cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail("bundle directory must be a real directory, not a symlink or other file type");
  }
  assertNormalizedMode(rootStat, 0o755, "bundle directory root");

  const files = new Map();
  const directories = [];

  async function walk(directoryPath, relativeDirectory) {
    const entries = await readdir(directoryPath);
    entries.sort(compareBytewise);
    for (const entry of entries) {
      const relativePath = relativeDirectory === "" ? entry : `${relativeDirectory}/${entry}`;
      assertSafeRelativePath(relativePath, "bundle entry path");
      const absolutePath = `${directoryPath}${sep}${entry}`;
      const entryStat = await lstat(absolutePath);
      if (entryStat.isSymbolicLink()) {
        fail(`bundle entry may not be a symbolic link: ${relativePath}`);
      }
      if (entryStat.isDirectory()) {
        assertNormalizedMode(entryStat, 0o755, `bundle directory ${relativePath}`);
        directories.push(relativePath);
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!entryStat.isFile()) {
        fail(`bundle entry must be a regular file: ${relativePath}`);
      }
      const expectedMode = relativePath === "source/scripts/build-occt-facade.sh"
        ? 0o755
        : 0o644;
      assertNormalizedMode(entryStat, expectedMode, `bundle file ${relativePath}`);
      if (entryStat.size > MAX_FILE_BYTES) {
        fail(`bundle entry exceeds the size limit: ${relativePath}`);
      }
      if (files.has(relativePath)) fail(`duplicate bundle entry: ${relativePath}`);
      files.set(relativePath, await readFile(absolutePath));
    }
  }

  await walk(rootPath, "");
  return {
    files,
    directories,
    format: "directory",
    inputPath: rootPath,
    bundleRoot: await realpath(rootPath),
  };
}

function readTarString(header, start, length, description, allowFullField = false) {
  const field = header.subarray(start, start + length);
  const nulIndex = field.indexOf(0);
  if (nulIndex === -1) {
    if (!allowFullField) fail(`${description} is not NUL-terminated`);
    return decodeUtf8(field, description);
  }
  if (field.subarray(nulIndex + 1).some((byte) => byte !== 0)) {
    fail(`${description} has non-zero bytes after its NUL terminator`);
  }
  const value = field.subarray(0, nulIndex);
  return decodeUtf8(value, description);
}

function readTarNumber(header, start, length, description) {
  const field = header.subarray(start, start + length);
  if ((field[0] ?? 0) & 0x80) fail(`${description} uses unsupported base-256 encoding`);
  const text = field.toString("ascii").replace(/\0.*$/u, "").trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/u.test(text)) fail(`${description} is not a valid octal number`);
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value)) fail(`${description} exceeds the safe integer range`);
  return value;
}

function assertTarChecksum(header, offset) {
  const expected = readTarNumber(header, 148, 8, `tar checksum at offset ${offset}`);
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index] ?? 0;
  }
  if (actual !== expected) fail(`tar header checksum mismatch at offset ${offset}`);
  const canonical = Buffer.from(`${actual.toString(8).padStart(6, "0")}\0 `, "ascii");
  if (!header.subarray(148, 156).equals(canonical)) {
    fail(`tar checksum encoding is not canonical at offset ${offset}`);
  }
}

function assertTarNumberEncoding(header, start, length, value, description) {
  const canonical = Buffer.from(
    `${value.toString(8).padStart(length - 1, "0")}\0`,
    "ascii",
  );
  if (!header.subarray(start, start + length).equals(canonical)) {
    fail(`${description} does not use canonical GNU ustar octal encoding`);
  }
}

function collectTarGz(inputPath, compressedBytes) {
  if (compressedBytes.length > MAX_ARCHIVE_BYTES) fail("compressed bundle exceeds the size limit");
  if (
    compressedBytes.length < 18 ||
    compressedBytes[0] !== 0x1f ||
    compressedBytes[1] !== 0x8b ||
    compressedBytes[2] !== 0x08 ||
    compressedBytes[3] !== 0x00 ||
    compressedBytes.subarray(4, 8).some((byte) => byte !== 0) ||
    compressedBytes[8] !== 0x02 ||
    compressedBytes[9] !== 0x03
  ) {
    fail("archive gzip header is not normalized GNU gzip -n -9 output");
  }
  let archive;
  try {
    const inflated = inflateRawSync(compressedBytes.subarray(10), {
      info: true,
      maxOutputLength: MAX_ARCHIVE_BYTES,
    });
    archive = inflated.buffer;
    const trailerOffset = 10 + inflated.engine.bytesWritten;
    if (trailerOffset + 8 !== compressedBytes.length) {
      fail("archive must contain exactly one gzip member with no trailing bytes");
    }
    const expectedCrc = compressedBytes.readUInt32LE(trailerOffset);
    const expectedSize = compressedBytes.readUInt32LE(trailerOffset + 4);
    if (crc32(archive) !== expectedCrc || (archive.length >>> 0) !== expectedSize) {
      fail("archive gzip trailer checksum or size is invalid");
    }
  } catch (error) {
    if (error instanceof OcctFacadeBundleVerificationError) throw error;
    fail(`bundle is not a valid bounded gzip archive: ${error instanceof Error ? error.message : String(error)}`);
  }

  const files = new Map();
  const directories = [];
  const seenArchivePaths = new Set();
  const orderedArchivePaths = [];
  let offset = 0;
  let sawEnd = false;

  while (offset + 512 <= archive.length) {
    const headerOffset = offset;
    const header = archive.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) {
      sawEnd = true;
      break;
    }
    assertTarChecksum(header, headerOffset);
    if (
      !header.subarray(257, 263).equals(Buffer.from("ustar\0")) ||
      !header.subarray(263, 265).equals(Buffer.from("00"))
    ) {
      fail(`tar entry at offset ${headerOffset} is not POSIX ustar`);
    }
    if (header.subarray(500, 512).some((byte) => byte !== 0)) {
      fail(`tar reserved header bytes are non-zero at offset ${headerOffset}`);
    }
    const uid = readTarNumber(header, 108, 8, `tar uid at offset ${headerOffset}`);
    const gid = readTarNumber(header, 116, 8, `tar gid at offset ${headerOffset}`);
    const mtime = readTarNumber(header, 136, 12, `tar mtime at offset ${headerOffset}`);
    assertTarNumberEncoding(header, 108, 8, uid, `tar uid at offset ${headerOffset}`);
    assertTarNumberEncoding(header, 116, 8, gid, `tar gid at offset ${headerOffset}`);
    assertTarNumberEncoding(header, 136, 12, mtime, `tar mtime at offset ${headerOffset}`);
    if (uid !== 0 || gid !== 0 || mtime !== 0) {
      fail(`tar ownership or timestamp is not normalized at offset ${headerOffset}`);
    }
    if (
      readTarString(header, 157, 100, "tar link name") !== "" ||
      readTarString(header, 265, 32, "tar owner name") !== "" ||
      readTarString(header, 297, 32, "tar group name") !== "" ||
      readTarNumber(header, 329, 8, `tar device major at offset ${headerOffset}`) !== 0 ||
      readTarNumber(header, 337, 8, `tar device minor at offset ${headerOffset}`) !== 0
    ) {
      fail(`tar owner, link, or device fields are not normalized at offset ${headerOffset}`);
    }
    if (
      header.subarray(329, 345).some((byte) => byte !== 0)
    ) {
      fail(`tar device fields are not zero-filled at offset ${headerOffset}`);
    }
    const size = readTarNumber(header, 124, 12, `tar entry size at offset ${headerOffset}`);
    assertTarNumberEncoding(header, 124, 12, size, `tar size at offset ${headerOffset}`);
    if (size > MAX_FILE_BYTES) fail(`tar entry at offset ${headerOffset} exceeds the size limit`);
    const paddedSize = Math.ceil(size / 512) * 512;
    if (offset + paddedSize > archive.length) fail("tar entry extends beyond the archive boundary");
    const content = archive.subarray(offset, offset + size);
    const padding = archive.subarray(offset + size, offset + paddedSize);
    if (padding.some((byte) => byte !== 0)) fail("tar file padding must be zero-filled");
    offset += paddedSize;

    const type = String.fromCharCode(header[156] ?? 0);
    const name = readTarString(header, 0, 100, "tar entry name", true);
    const prefix = readTarString(header, 345, 155, "tar entry prefix");
    const archivePath = prefix === "" ? name : `${prefix}/${name}`;

    const isDirectory = type === "5";
    const isRegular = type === "0";
    if (!isDirectory && !isRegular) {
      fail(`tar entry is not a regular file or directory: ${JSON.stringify(archivePath)}`);
    }
    if (isDirectory && size !== 0) fail(`tar directory has non-zero size: ${archivePath}`);
    if (isDirectory && !archivePath.endsWith("/")) {
      fail(`tar directory name must end with '/': ${archivePath}`);
    }
    const canonicalArchivePath = isDirectory && archivePath.endsWith("/")
      ? archivePath.slice(0, -1)
      : archivePath;
    assertSafeRelativePath(canonicalArchivePath, "tar entry path");
    if (seenArchivePaths.has(canonicalArchivePath)) {
      fail(`duplicate tar entry: ${canonicalArchivePath}`);
    }
    seenArchivePaths.add(canonicalArchivePath);
    orderedArchivePaths.push(canonicalArchivePath);

    const mode = readTarNumber(header, 100, 8, `tar mode for ${canonicalArchivePath}`);
    const expectedMode = canonicalArchivePath === BUNDLE_DIRECTORY || isDirectory ||
      canonicalArchivePath === `${BUNDLE_DIRECTORY}/source/scripts/build-occt-facade.sh`
      ? 0o755
      : 0o644;
    if (mode !== expectedMode) {
      fail(`tar mode for ${canonicalArchivePath} is ${mode.toString(8)}; expected ${expectedMode.toString(8)}`);
    }
    assertTarNumberEncoding(
      header,
      100,
      8,
      mode,
      `tar mode for ${canonicalArchivePath}`,
    );

    if (canonicalArchivePath === BUNDLE_DIRECTORY) {
      if (!isDirectory) fail("archive bundle root must be a directory");
      continue;
    }
    const rootPrefix = `${BUNDLE_DIRECTORY}/`;
    if (!canonicalArchivePath.startsWith(rootPrefix)) {
      fail(`tar entry is outside the required ${BUNDLE_DIRECTORY}/ root: ${canonicalArchivePath}`);
    }
    const relativePath = canonicalArchivePath.slice(rootPrefix.length);
    assertSafeRelativePath(relativePath, "bundle entry path");
    if (isDirectory) {
      directories.push(relativePath);
    } else {
      files.set(relativePath, Buffer.from(content));
    }
  }

  if (!sawEnd) fail("tar archive is missing its end marker");
  if (archive.length % 512 !== 0 || archive.length - offset < 512) {
    fail("tar archive must end with at least two zero blocks");
  }
  if (archive.subarray(offset).some((byte) => byte !== 0)) {
    fail("tar archive has non-zero trailing data after its end marker");
  }
  const expectedArchivePaths = [
    BUNDLE_DIRECTORY,
    ...EXPECTED_DIRECTORIES.map((path) => `${BUNDLE_DIRECTORY}/${path}`),
    ...EXPECTED_FILE_PATHS.map((path) => `${BUNDLE_DIRECTORY}/${path}`),
  ].sort(compareBytewise);
  if (
    orderedArchivePaths.length !== expectedArchivePaths.length ||
    orderedArchivePaths.some((path, index) => path !== expectedArchivePaths[index])
  ) {
    fail("tar entries must contain the exact bundle tree in bytewise path order");
  }
  return {
    files,
    directories,
    format: "tar.gz",
    inputPath: resolve(inputPath),
    bundleRoot: `${resolve(inputPath)}#${BUNDLE_DIRECTORY}`,
    archiveSha256: sha256(compressedBytes),
  };
}

async function collectInput(inputPath, trustedArchive) {
  let inputStat;
  try {
    inputStat = await lstat(inputPath);
  } catch (error) {
    fail(`bundle input does not exist: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (inputStat.isSymbolicLink()) fail("bundle input may not be a symbolic link");
  if (inputStat.isDirectory()) return collectDirectory(inputPath);
  if (!inputStat.isFile() || !inputPath.endsWith(".tar.gz")) {
    fail("bundle input must be a directory or a .tar.gz archive");
  }
  if (inputStat.size > MAX_ARCHIVE_BYTES) fail("compressed bundle exceeds the size limit");
  if (trustedArchive !== undefined && inputStat.size !== trustedArchive.size) {
    fail(
      `trusted release archive size mismatch: expected ${trustedArchive.size}, got ${inputStat.size}`,
    );
  }
  const bytes = await readFile(inputPath);
  if (trustedArchive !== undefined) {
    const digest = sha256(bytes);
    if (digest !== trustedArchive.sha256) {
      fail(
        `trusted release archive SHA-256 mismatch: expected ${trustedArchive.sha256}, got ${digest}`,
      );
    }
  }
  return collectTarGz(inputPath, bytes);
}

function parseManifest(files) {
  const bytes = files.get("SHA256SUMS");
  if (bytes === undefined) fail("SHA256SUMS is missing");
  const text = decodeUtf8(bytes, "SHA256SUMS");
  if (!text.endsWith("\n")) fail("SHA256SUMS must end with a newline");
  const lines = text.slice(0, -1).split("\n");
  const manifest = new Map();
  for (const [index, line] of lines.entries()) {
    const match = /^([0-9a-f]{64})  ([^\r\n]+)$/u.exec(line);
    if (match === null) fail(`SHA256SUMS line ${index + 1} has an invalid format`);
    const digest = match[1];
    const path = assertSafeRelativePath(match[2], `SHA256SUMS line ${index + 1} path`);
    if (manifest.has(path)) fail(`SHA256SUMS contains a duplicate path: ${path}`);
    manifest.set(path, digest);
  }
  const paths = [...manifest.keys()];
  const sorted = [...paths].sort(compareBytewise);
  if (!paths.every((path, index) => path === sorted[index])) {
    fail("SHA256SUMS paths must be sorted bytewise");
  }
  assertExactSet(paths, EXPECTED_PAYLOAD_PATHS, "SHA256SUMS coverage");
  for (const [path, expectedDigest] of manifest) {
    const bytesForPath = files.get(path);
    if (bytesForPath === undefined) fail(`manifested file is missing: ${path}`);
    const actualDigest = sha256(bytesForPath);
    if (actualDigest !== expectedDigest) {
      fail(`SHA-256 mismatch for ${path}: expected ${expectedDigest}, got ${actualDigest}`);
    }
  }
  return manifest;
}

function verifyRuntime(files, manifest, release, runtimePins) {
  const runtime = asArray(release.runtime, "release.runtime");
  if (runtime.length !== RUNTIME_PATHS.length) {
    fail(`release.runtime must describe exactly ${RUNTIME_PATHS.length} files`);
  }
  const entries = new Map();
  for (const [index, rawEntry] of runtime.entries()) {
    const entry = asObject(rawEntry, `release.runtime[${index}]`);
    const path = assertSafeRelativePath(entry.path, `release.runtime[${index}].path`);
    if (entries.has(path)) fail(`release.runtime contains a duplicate path: ${path}`);
    entries.set(path, entry);
  }
  assertExactSet([...entries.keys()], RUNTIME_PATHS, "release.runtime paths");
  for (const path of RUNTIME_PATHS) {
    const entry = entries.get(path);
    const bytes = files.get(path);
    if (entry === undefined || bytes === undefined) fail(`runtime metadata is incomplete for ${path}`);
    const size = asInteger(entry.size, `release runtime size for ${path}`);
    if (size !== bytes.length) fail(`runtime size mismatch for ${path}: expected ${size}, got ${bytes.length}`);
    const digest = assertSha256(entry.sha256, `release runtime digest for ${path}`);
    if (digest !== manifest.get(path)) fail(`release runtime digest does not match SHA256SUMS for ${path}`);
    const expectedMediaType = path.endsWith(".wasm") ? "application/wasm" : "text/javascript";
    if (entry.mediaType !== expectedMediaType) {
      fail(`release runtime media type for ${path} must be ${expectedMediaType}`);
    }
    const trusted = runtimePins.find((candidate) => candidate.target === path);
    if (
      trusted === undefined ||
      size !== trusted.size ||
      digest !== trusted.sha256 ||
      entry.mediaType !== trusted.mediaType
    ) {
      fail(`release runtime metadata does not match the trusted release pin for ${path}`);
    }
  }

  const js = files.get("runtime/occt-wasm.js");
  const wasm = files.get("runtime/occt-wasm.wasm");
  if (js === undefined || wasm === undefined) fail("runtime pair is incomplete");
  if (js.length === 0 || !decodeUtf8(js, "runtime/occt-wasm.js").includes("occt-wasm.wasm")) {
    fail("runtime JavaScript is not recognizable matched occt-wasm glue");
  }
  if (wasm.length < 8 || !wasm.subarray(0, 4).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d]))) {
    fail("runtime/occt-wasm.wasm does not have a WebAssembly header");
  }
  for (const marker of [
    FACADE_MARKER,
    "invariantcadFacadeVersion",
    "invariantcadDraftFacesAtomic",
    "InvariantCadDraftReport",
    "InvariantCadPipeShellReport",
    "InvariantCadBooleanOperation",
    "InvariantCadBooleanReport",
    "InvariantCadEdgeTreatmentOperation",
    "InvariantCadEdgeTreatmentReport",
    "InvariantCadSolidOffsetOperation",
    "InvariantCadSolidOffsetDirection",
    "InvariantCadSolidOffsetReport",
    "InvariantCadArtifactWriteReport",
    "InvariantCadArtifactReadReport",
    "InvariantCadTopologyKind",
    "InvariantCadTopologyRelation",
    "invariantcadPipeShellSolid",
    "invariantcadBooleanAtomic",
    "invariantcadEdgeTreatmentAtomic",
    "invariantcadSolidOffsetAtomic",
    "invariantcadWriteArtifactBrep",
    "invariantcadReadArtifactBrep",
    "maxNativeRequestedBytes",
    "nativeRequestedBytes",
    "nativeAllocationCalls",
    "nativeRequestLimitExceeded",
    "NATIVE_REQUEST_LIMIT_EXCEEDED",
    "maxPreflightWorkUnits",
    "preflightWorkUnits",
    "maxPreflightNestingDepth",
    "preflightMaximumDepth",
    "maxPreflightLocationPower",
    "preflightMaximumLocationPower",
    "preflightConsumedByteCount",
    "preflightCode",
    "archivePreflightComplete",
    "deserializationStarted",
    "INVALID_PREFLIGHT_WORK_LIMIT",
    "INVALID_PREFLIGHT_NESTING_LIMIT",
    "INVALID_PREFLIGHT_LOCATION_POWER_LIMIT",
    "WORK_LIMIT_EXCEEDED",
    "NESTING_LIMIT_EXCEEDED",
    "LOCATION_POWER_LIMIT_EXCEEDED",
    "PROFILE_MISMATCH",
    "TRAILING_INPUT",
  ]) {
    if (!wasm.includes(Buffer.from(marker))) {
      fail(`runtime WASM does not contain the required facade ABI marker: ${marker}`);
    }
  }
}

function verifyRelease(files, manifest, releaseInput, runtimePins) {
  const release = asObject(parseJsonFile(files, "metadata/release.json"), "metadata/release.json");
  assertCanonicalGeneratedJson(
    files,
    "metadata/release.json",
    expectedRelease(releaseInput, runtimePins),
  );
  assertExactKeys(release, ["schemaVersion", "bundle", "facade", "runtime", "source", "integrity"], "release");
  if (release.schemaVersion !== 1) fail("release.schemaVersion must be 1");
  const bundle = asObject(release.bundle, "release.bundle");
  assertExactKeys(bundle, ["name", "version", "layoutVersion"], "release.bundle");
  if (bundle.name !== BUNDLE_NAME) fail(`release.bundle.name must be ${BUNDLE_NAME}`);
  if (bundle.version !== BUNDLE_VERSION) fail(`release.bundle.version must be ${BUNDLE_VERSION}`);
  if (bundle.layoutVersion !== 1) fail("release.bundle.layoutVersion must be 1");
  const facade = asObject(release.facade, "release.facade");
  assertExactKeys(facade, ["marker", "abiVersion", "upstreamOcctWasmVersion"], "release.facade");
  if (facade.marker !== FACADE_MARKER) fail(`release.facade.marker must be ${FACADE_MARKER}`);
  if (facade.abiVersion !== BUNDLE_VERSION) {
    fail(`release.facade.abiVersion must be "${BUNDLE_VERSION}"`);
  }
  if (facade.upstreamOcctWasmVersion !== UPSTREAM_OCCT_WASM_VERSION) {
    fail(`release.facade.upstreamOcctWasmVersion must be ${UPSTREAM_OCCT_WASM_VERSION}`);
  }
  const integrity = asObject(release.integrity, "release.integrity");
  assertExactKeys(integrity, ["algorithm", "manifestPath", "coverage"], "release.integrity");
  if (integrity.algorithm !== "SHA-256") fail('release.integrity.algorithm must be "SHA-256"');
  if (integrity.manifestPath !== "SHA256SUMS") fail('release.integrity.manifestPath must be "SHA256SUMS"');
  if (integrity.coverage !== "all regular bundle files except SHA256SUMS") {
    fail('release.integrity.coverage must be "all regular bundle files except SHA256SUMS"');
  }

  const source = asObject(release.source, "release.source");
  assertExactKeys(source, ["lockPath", "buildScriptPath", "patches", "relinkInstructionsPath", "materials"], "release.source");
  if (source.lockPath !== "source/native/occt/upstream.lock.json") {
    fail("release.source.lockPath is not the required locked source input");
  }
  if (source.buildScriptPath !== "source/scripts/build-occt-facade.sh") {
    fail("release.source.buildScriptPath is not the required build recipe");
  }
  if (source.relinkInstructionsPath !== "SOURCE_AND_RELINK.md") {
    fail("release.source.relinkInstructionsPath is not the required relink guide");
  }
  const patches = asArray(source.patches, "release.source.patches");
  if (patches.length !== PATCH_PATHS.length) fail("release.source.patches is incomplete");
  const patchEntries = [];
  for (const [index, rawPatch] of patches.entries()) {
    const patch = asObject(rawPatch, `release.source.patches[${index}]`);
    assertExactKeys(patch, ["path", "size", "sha256"], `release.source.patches[${index}]`);
    const path = assertSafeRelativePath(patch.path, `release.source.patches[${index}].path`);
    const digest = assertSha256(patch.sha256, `release.source.patches[${index}].sha256`);
    if (digest !== manifest.get(path)) fail(`release source digest does not match SHA256SUMS for ${path}`);
    const pinnedPatch = releaseInput.inputs.find((entry) => entry.target === path && entry.role === "source-patch");
    if (
      pinnedPatch === undefined ||
      asInteger(patch.size, `release.source.patches[${index}].size`) !== pinnedPatch.size ||
      digest !== pinnedPatch.sha256
    ) {
      fail(`release source patch metadata does not match the trusted input for ${path}`);
    }
    patchEntries.push(path);
  }
  if (!patchEntries.every((path, index) => path === PATCH_PATHS[index])) {
    fail("release.source.patches must list the complete ordered patch series");
  }
  const expectedMaterials = releaseInput.inputs.filter((entry) => entry.target.startsWith("source/"));
  const materials = asArray(source.materials, "release.source.materials");
  if (materials.length !== expectedMaterials.length) fail("release.source.materials is incomplete");
  for (const [index, rawMaterial] of materials.entries()) {
    const material = asObject(rawMaterial, `release.source.materials[${index}]`);
    assertExactKeys(material, ["path", "role", "size", "sha256"], `release.source.materials[${index}]`);
    const expected = expectedMaterials[index];
    if (
      expected === undefined ||
      material.path !== expected.target ||
      material.role !== expected.role ||
      material.size !== expected.size ||
      material.sha256 !== expected.sha256
    ) {
      fail(`release.source.materials[${index}] does not match the ordered trusted source inputs`);
    }
  }
  verifyRuntime(files, manifest, release, runtimePins);
  return release;
}

function verifySourceInputs(files) {
  const lock = asObject(parseJsonFile(files, "source/native/occt/upstream.lock.json"), "source lock");
  if (lock.schemaVersion !== 1) fail("source lock schemaVersion must be 1");
  const upstream = asObject(lock.upstream, "source lock upstream");
  const occt = asObject(lock.occt, "source lock occt");
  const toolchain = asObject(lock.toolchain, "source lock toolchain");
  const builder = asObject(lock.builder, "source lock builder");
  if (
    upstream.tag !== "v3.7.0" ||
    upstream.commit !== "fe3d5effdaa1ca9a4007a86fde46abd62722fbba" ||
    occt.commit !== "6e1fe656bf028bf0004482c389661587b269fc65" ||
    toolchain.emscripten !== "5.0.3" ||
    toolchain.rust !== "1.95" ||
    builder.digest !== "sha256:d4d9b7232c92eda68e478aba5bbf1e8880e0f6c8aeeee627d8296f994642848b" ||
    builder.platform !== "linux/amd64"
  ) {
    fail("source lock does not match the audited OCCT facade build inputs");
  }
  const requiredContent = new Map([
    [PATCH_PATHS[0], ["invariantcadDraftFacesAtomic", "ANGLE_BELOW_KERNEL_LIMIT"]],
    [PATCH_PATHS[1], ["InvariantCadIndexedTopologyEvolution", DRAFT_FACADE_MARKER]],
    [
      PATCH_PATHS[2],
      [
        "InvariantCadPipeShellReport",
        "invariantcadPipeShellSolid",
        CONTROLLED_PIPE_SHELL_FACADE_MARKER,
      ],
    ],
    [
      PATCH_PATHS[3],
      [
        "InvariantCadBooleanReport",
        "invariantcadBooleanAtomic",
        BOOLEAN_FACADE_MARKER,
      ],
    ],
    [
      PATCH_PATHS[4],
      [
        "InvariantCadEdgeTreatmentReport",
        "invariantcadEdgeTreatmentAtomic",
        EDGE_TREATMENT_FACADE_MARKER,
      ],
    ],
    [
      PATCH_PATHS[5],
      [
        "InvariantCadSolidOffsetReport",
        "invariantcadSolidOffsetAtomic",
        "reconcileGeneratedOnlyReplacements",
        SOLID_OFFSET_FACADE_MARKER,
      ],
    ],
    [
      PATCH_PATHS[6],
      [
        "BoundedArtifactOutputBuffer",
        "InvariantCadArtifactWriteReport",
        "InvariantCadArtifactReadReport",
        "OUTPUT_LIMIT_EXCEEDED",
        BOUNDED_ARTIFACT_FACADE_MARKER,
      ],
    ],
    [
      PATCH_PATHS[7],
      [
        "invariantcad_allocation_budget.h",
        "maxNativeRequestedBytes",
        "nativeRequestedBytes",
        "nativeAllocationCalls",
        "nativeRequestLimitExceeded",
        "NATIVE_REQUEST_LIMIT_EXCEEDED",
        "--wrap=_ZN8Standard8AllocateEm",
        "--wrap=_ZN8Standard15AllocateOptimalEm",
        "--wrap=_ZN8Standard10ReallocateEPvm",
        "--wrap=_ZN8Standard15AllocateAlignedEmm",
        "--wrap=_Znwm",
        "--wrap=_Znam",
        "--wrap=malloc",
        "--wrap=calloc",
        "--wrap=realloc",
        "--wrap=posix_memalign",
        "--wrap=aligned_alloc",
        "--wrap=memalign",
        HARDENED_ARTIFACT_FACADE_MARKER,
      ],
    ],
    [
      PATCH_PATHS[8],
      [
        "invariantcad_bintools_v4_preflight.h",
        "invariantcad_bintools_v4_preflight.cpp",
        "Open CASCADE Topology V4",
        "invariantcadPreflightBinToolsV4",
        "maxPreflightWorkUnits",
        "preflightWorkUnits",
        "maxPreflightNestingDepth",
        "preflightMaximumDepth",
        "maxPreflightLocationPower",
        "preflightMaximumLocationPower",
        "preflightConsumedByteCount",
        "preflightCode",
        "archivePreflightComplete",
        "deserializationStarted",
        "WORK_LIMIT_EXCEEDED",
        "NESTING_LIMIT_EXCEEDED",
        "LOCATION_POWER_LIMIT_EXCEEDED",
        "PROFILE_MISMATCH",
        "TRAILING_INPUT",
        "ShapeMetrics",
        "expandedOccurrences",
        "Owned writer location table contains no duplicate chains",
        FACADE_MARKER,
      ],
    ],
    ["source/scripts/build-occt-facade.sh", ["--network=none", "CARGO_NET_OFFLINE=true", "--fuzz=0"]],
    ["SOURCE_AND_RELINK.md", ["source", "relink", "replace"]],
  ]);
  for (const [path, needles] of requiredContent) {
    const bytes = files.get(path);
    if (bytes === undefined) fail(`required source input is missing: ${path}`);
    const text = decodeUtf8(bytes, path);
    for (const needle of needles) {
      if (!text.toLowerCase().includes(needle.toLowerCase())) {
        fail(`${path} is incomplete; required content is missing: ${needle}`);
      }
    }
  }
  return lock;
}

function verifyLicenses(files) {
  const requirements = new Map([
    ["LICENSE", ["Apache License", "Version 2.0"]],
    ["THIRD_PARTY_NOTICES.md", ["occt-wasm", "OpenCascade", "LGPL"]],
    ["licenses/LGPL-2.1.txt", ["GNU LESSER GENERAL PUBLIC LICENSE", "Version 2.1"]],
    ["licenses/OCCT_LGPL_EXCEPTION.txt", ["Open CASCADE", "exception"]],
    ["licenses/occt-wasm-MIT.txt", ["MIT License", "Permission is hereby granted"]],
  ]);
  for (const [path, needles] of requirements) {
    const bytes = files.get(path);
    if (bytes === undefined || bytes.length < 128) fail(`required license material is missing or truncated: ${path}`);
    const text = decodeUtf8(bytes, path);
    for (const needle of needles) {
      if (!text.toLowerCase().includes(needle.toLowerCase())) {
        fail(`required license material is incomplete: ${path} lacks ${needle}`);
      }
    }
  }
}

function expectedRelease(releaseInput, runtimePins) {
  const sourceMaterials = releaseInput.inputs.filter((entry) =>
    entry.target.startsWith("source/"),
  );
  return {
    schemaVersion: 1,
    bundle: {
      name: releaseInput.bundle.name,
      version: releaseInput.bundle.version,
      layoutVersion: releaseInput.bundle.layoutVersion,
    },
    facade: releaseInput.facade,
    runtime: runtimePins.map((entry) => ({
      path: entry.target,
      mediaType: entry.mediaType,
      size: entry.size,
      sha256: entry.sha256,
    })),
    source: {
      lockPath: "source/native/occt/upstream.lock.json",
      buildScriptPath: "source/scripts/build-occt-facade.sh",
      patches: sourceMaterials
        .filter((entry) => entry.role === "source-patch")
        .map((entry) => ({
          path: entry.target,
          size: entry.size,
          sha256: entry.sha256,
        })),
      relinkInstructionsPath: "SOURCE_AND_RELINK.md",
      materials: sourceMaterials.map((entry) => ({
        path: entry.target,
        role: entry.role,
        size: entry.size,
        sha256: entry.sha256,
      })),
    },
    integrity: {
      algorithm: "SHA-256",
      manifestPath: "SHA256SUMS",
      coverage: "all regular bundle files except SHA256SUMS",
    },
  };
}

function expectedSbom(releaseInput, runtimePins, lock) {
  const bundleRef = `${releaseInput.bundle.name}@${releaseInput.bundle.version}`;
  const facadeRef = `pkg:generic/${releaseInput.bundle.name}@${releaseInput.bundle.version}`;
  const occtWasmRef = `pkg:generic/occt-wasm@${releaseInput.facade.upstreamOcctWasmVersion}`;
  const occtRef = `pkg:generic/opencascade-technology@${lock.occt.commit}`;
  const builderDigest = lock.builder.digest.replace(/^sha256:/u, "");
  const runtimeComponents = runtimePins.map((entry) => ({
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
      { ref: "file:runtime/occt-wasm.js", dependsOn: [occtWasmRef] },
      {
        ref: "file:runtime/occt-wasm.wasm",
        dependsOn: [occtWasmRef, occtRef],
      },
      { ref: occtWasmRef, dependsOn: [occtRef] },
      { ref: occtRef, dependsOn: [] },
    ],
  };
}

function expectedProvenance(releaseInput, runtimePins, lock) {
  const patchOrder = releaseInput.inputs
    .filter((entry) => entry.role === "source-patch")
    .map((entry) => entry.target);
  const builderDigest = lock.builder.digest.replace(/^sha256:/u, "");
  const recipeMaterials = releaseInput.inputs
    .filter((entry) => entry.target.startsWith("source/"))
    .map((entry) => ({
      uri: `file:${entry.target}`,
      digest: { sha256: entry.sha256 },
    }));
  return {
    _type: "https://in-toto.io/Statement/v1",
    subject: runtimePins.map((entry) => ({
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
          patchOrder,
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

function collectLicenseStrings(component) {
  const values = [];
  const licenses = component.licenses;
  if (!Array.isArray(licenses)) return values;
  for (const item of licenses) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    if (typeof item.expression === "string") values.push(item.expression);
    if (item.license !== null && typeof item.license === "object" && !Array.isArray(item.license)) {
      if (typeof item.license.id === "string") values.push(item.license.id);
      if (typeof item.license.name === "string") values.push(item.license.name);
    }
  }
  return values;
}

function propertyValue(component, name) {
  if (!Array.isArray(component.properties)) return undefined;
  const property = component.properties.find((candidate) => {
    return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate) && candidate.name === name;
  });
  return property?.value;
}

function verifySbom(files, manifest, runtimePins, releaseInput, lock) {
  const sbom = asObject(parseJsonFile(files, "metadata/sbom.cdx.json"), "SBOM");
  const expected = expectedSbom(releaseInput, runtimePins, lock);
  assertCanonicalGeneratedJson(files, "metadata/sbom.cdx.json", expected);
  if (!isDeepStrictEqual(sbom, expected)) {
    fail("SBOM does not exactly match the trusted release component inventory and dependency graph");
  }
  assertExactKeys(sbom, ["bomFormat", "specVersion", "version", "metadata", "components", "dependencies"], "SBOM");
  if (sbom.bomFormat !== "CycloneDX") fail("SBOM bomFormat must be CycloneDX");
  if (sbom.specVersion !== "1.6") fail('SBOM specVersion must be "1.6"');
  if (sbom.version !== 1) fail("SBOM version must be 1");
  const metadata = asObject(sbom.metadata, "SBOM metadata");
  const rootComponent = asObject(metadata.component, "SBOM metadata.component");
  const facadeRef = `pkg:generic/${BUNDLE_NAME}@${BUNDLE_VERSION}`;
  if (
    rootComponent.name !== BUNDLE_NAME ||
    rootComponent.version !== BUNDLE_VERSION ||
    rootComponent["bom-ref"] !== facadeRef ||
    !collectLicenseStrings(rootComponent).includes("Apache-2.0") ||
    propertyValue(rootComponent, "invariantcad:facade:marker") !== FACADE_MARKER
  ) {
    fail("SBOM root component does not identify this bundle version");
  }
  const components = asArray(sbom.components, "SBOM components");
  const wrapperRef = `pkg:generic/occt-wasm@${UPSTREAM_OCCT_WASM_VERSION}`;
  const occtRef = "pkg:generic/opencascade-technology@6e1fe656bf028bf0004482c389661587b269fc65";
  const builderRef = "oci:ghcr.io/andymai/occt-wasm-builder@sha256:d4d9b7232c92eda68e478aba5bbf1e8880e0f6c8aeeee627d8296f994642848b";
  const expectedRefs = [
    "file:runtime/occt-wasm.js",
    "file:runtime/occt-wasm.wasm",
    wrapperRef,
    occtRef,
    "tool:emscripten@5.0.3",
    "tool:rust@1.95",
    builderRef,
  ];
  const componentRecords = components.map((candidate, index) => asObject(candidate, `SBOM components[${index}]`));
  const refs = componentRecords.map((component, index) => asString(component["bom-ref"], `SBOM components[${index}].bom-ref`));
  assertExactSet(refs, expectedRefs, "SBOM component inventory");
  const occtWasm = components.find((candidate) => {
    const component = candidate !== null && typeof candidate === "object" && !Array.isArray(candidate) ? candidate : {};
    return component.name === "occt-wasm";
  });
  const occt = components.find((candidate) => {
    const component = candidate !== null && typeof candidate === "object" && !Array.isArray(candidate) ? candidate : {};
    return component.name === "Open CASCADE Technology" || component.name === "OCCT";
  });
  if (occtWasm === undefined || occt === undefined) {
    fail("SBOM must contain both occt-wasm and Open CASCADE Technology components");
  }
  const wrapper = asObject(occtWasm, "occt-wasm SBOM component");
  const kernel = asObject(occt, "OCCT SBOM component");
  if (wrapper.version !== UPSTREAM_OCCT_WASM_VERSION) fail("SBOM occt-wasm version is incorrect");
  if (!collectLicenseStrings(wrapper).some((value) => value.toUpperCase().includes("MIT"))) {
    fail("SBOM occt-wasm component must declare its MIT license");
  }
  if (!collectLicenseStrings(kernel).some((value) => value.toUpperCase().includes("LGPL-2.1"))) {
    fail("SBOM OCCT component must declare LGPL-2.1");
  }
  for (const path of RUNTIME_PATHS) {
    const component = componentRecords.find((candidate) => candidate["bom-ref"] === `file:${path}`);
    const pin = runtimePins.find((candidate) => candidate.target === path);
    if (component === undefined || pin === undefined) fail(`SBOM runtime component is missing: ${path}`);
    const hashes = asArray(component.hashes, `SBOM hashes for ${path}`);
    const hash = hashes.find((candidate) => {
      return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate) && candidate.alg === "SHA-256";
    });
    if (
      hash?.content !== pin.sha256 ||
      hash.content !== manifest.get(path) ||
      propertyValue(component, "invariantcad:bundle:path") !== path ||
      propertyValue(component, "invariantcad:file:size") !== String(pin.size)
    ) {
      fail(`SBOM runtime component does not match the trusted release pin: ${path}`);
    }
  }
  const emscripten = componentRecords.find((component) => component["bom-ref"] === "tool:emscripten@5.0.3");
  const rust = componentRecords.find((component) => component["bom-ref"] === "tool:rust@1.95");
  const builder = componentRecords.find((component) => component["bom-ref"] === builderRef);
  if (
    emscripten?.version !== "5.0.3" ||
    emscripten.scope !== "excluded" ||
    rust?.version !== "1.95" ||
    rust.scope !== "excluded" ||
    builder?.version !== "sha256:d4d9b7232c92eda68e478aba5bbf1e8880e0f6c8aeeee627d8296f994642848b" ||
    builder.scope !== "excluded"
  ) {
    fail("SBOM build-tool inventory does not match the audited build lock");
  }
  const dependencies = asArray(sbom.dependencies, "SBOM dependencies");
  const expectedDependencies = new Map([
    [facadeRef, ["file:runtime/occt-wasm.js", "file:runtime/occt-wasm.wasm"]],
    ["file:runtime/occt-wasm.js", [wrapperRef]],
    ["file:runtime/occt-wasm.wasm", [wrapperRef, occtRef]],
    [wrapperRef, [occtRef]],
    [occtRef, []],
  ]);
  if (dependencies.length !== expectedDependencies.size) fail("SBOM dependency graph is incomplete");
  for (const rawDependency of dependencies) {
    const dependency = asObject(rawDependency, "SBOM dependency");
    const ref = asString(dependency.ref, "SBOM dependency.ref");
    const dependsOn = asArray(dependency.dependsOn, `SBOM dependency ${ref}.dependsOn`);
    const expected = expectedDependencies.get(ref);
    if (expected === undefined) fail(`SBOM dependency graph has an unexpected ref: ${ref}`);
    assertExactSet(dependsOn, expected, `SBOM dependency ${ref}`);
  }
}

function verifyProvenance(files, manifest, release, releaseInput, runtimePins, lock) {
  const provenance = asObject(parseJsonFile(files, "metadata/provenance.json"), "provenance");
  const expected = expectedProvenance(releaseInput, runtimePins, lock);
  assertCanonicalGeneratedJson(files, "metadata/provenance.json", expected);
  if (!isDeepStrictEqual(provenance, expected)) {
    fail("provenance does not exactly match the trusted recipe, dependencies, and limitations");
  }
  assertExactKeys(provenance, ["_type", "subject", "predicateType", "predicate"], "provenance");
  if (provenance._type !== "https://in-toto.io/Statement/v1") {
    fail("provenance must be an in-toto Statement v1");
  }
  if (provenance.predicateType !== "https://invariantcad.dev/provenance/occt-facade-recipe/v1") {
    fail("provenance predicateType is not the supported OCCT facade recipe schema");
  }
  const subject = asArray(provenance.subject, "provenance.subject");
  const subjects = new Map();
  for (const [index, rawSubject] of subject.entries()) {
    const entry = asObject(rawSubject, `provenance.subject[${index}]`);
    assertExactKeys(entry, ["name", "digest"], `provenance.subject[${index}]`);
    const path = assertSafeRelativePath(entry.name, `provenance.subject[${index}].name`);
    if (subjects.has(path)) fail(`provenance contains a duplicate subject: ${path}`);
    subjects.set(path, entry);
  }
  assertExactSet([...subjects.keys()], RUNTIME_PATHS, "provenance runtime subjects");
  for (const path of RUNTIME_PATHS) {
    const entry = subjects.get(path);
    if (entry === undefined) fail(`provenance subject is missing: ${path}`);
    const digest = asObject(entry.digest, `provenance subject digest for ${path}`);
    assertExactKeys(digest, ["sha256"], `provenance subject digest for ${path}`);
    const subjectDigest = assertSha256(digest.sha256, `provenance subject digest for ${path}`);
    if (subjectDigest !== manifest.get(path)) {
      fail(`provenance subject digest does not match SHA256SUMS for ${path}`);
    }
    const trusted = runtimePins.find((candidate) => candidate.target === path);
    if (trusted === undefined || subjectDigest !== trusted.sha256) {
      fail(`provenance subject does not match the trusted release pin for ${path}`);
    }
  }

  const predicate = asObject(provenance.predicate, "provenance.predicate");
  assertExactKeys(predicate, ["evidenceKind", "buildDefinition", "runDetails", "limitations"], "provenance.predicate");
  if (predicate.evidenceKind !== "verified-recipe-and-artifact-metadata") {
    fail("provenance evidenceKind overclaims or is unknown");
  }
  const buildDefinition = asObject(predicate.buildDefinition, "provenance buildDefinition");
  assertExactKeys(buildDefinition, ["buildType", "externalParameters", "internalParameters", "resolvedDependencies"], "provenance buildDefinition");
  if (buildDefinition.buildType !== "https://invariantcad.dev/build-types/digest-pinned-occt-facade/v1") {
    fail("provenance buildType is unknown");
  }
  const external = asObject(buildDefinition.externalParameters, "provenance externalParameters");
  assertExactKeys(external, ["upstream", "occt", "toolchain", "builder"], "provenance externalParameters");
  const upstream = asObject(external.upstream, "provenance upstream parameters");
  const occt = asObject(external.occt, "provenance OCCT parameters");
  const toolchain = asObject(external.toolchain, "provenance toolchain parameters");
  const externalBuilder = asObject(external.builder, "provenance builder parameters");
  if (
    upstream.repository !== "https://github.com/andymai/occt-wasm.git" ||
    upstream.tag !== "v3.7.0" ||
    upstream.commit !== "fe3d5effdaa1ca9a4007a86fde46abd62722fbba" ||
    occt.repository !== "https://github.com/andymai/OCCT.git" ||
    occt.commit !== "6e1fe656bf028bf0004482c389661587b269fc65" ||
    toolchain.emscripten !== "5.0.3" ||
    toolchain.rust !== "1.95" ||
    externalBuilder.image !== "ghcr.io/andymai/occt-wasm-builder" ||
    externalBuilder.digest !== "sha256:d4d9b7232c92eda68e478aba5bbf1e8880e0f6c8aeeee627d8296f994642848b" ||
    externalBuilder.platform !== "linux/amd64"
  ) {
    fail("provenance external parameters do not match the audited build lock");
  }
  const internal = asObject(buildDefinition.internalParameters, "provenance internalParameters");
  assertExactKeys(internal, ["facadeMarker", "patchOrder", "buildScript", "compileNetwork"], "provenance internalParameters");
  if (
    internal.facadeMarker !== FACADE_MARKER ||
    internal.buildScript !== "source/scripts/build-occt-facade.sh" ||
    internal.compileNetwork !== "none" ||
    !Array.isArray(internal.patchOrder) ||
    !internal.patchOrder.every((path, index) => path === PATCH_PATHS[index]) ||
    internal.patchOrder.length !== PATCH_PATHS.length
  ) {
    fail("provenance internal parameters do not match the trusted facade recipe");
  }
  const dependencies = asArray(buildDefinition.resolvedDependencies, "provenance resolvedDependencies");
  for (const required of [
    "fe3d5effdaa1ca9a4007a86fde46abd62722fbba",
    "6e1fe656bf028bf0004482c389661587b269fc65",
    "sha256:d4d9b7232c92eda68e478aba5bbf1e8880e0f6c8aeeee627d8296f994642848b",
    ...PATCH_PATHS,
    "source/native/occt/upstream.lock.json",
    "source/scripts/build-occt-facade.sh",
  ]) {
    if (!dependencies.some((dependency) => JSON.stringify(dependency).includes(required))) {
      fail(`provenance resolved dependencies are incomplete; missing ${required}`);
    }
  }
  for (const sourceInput of releaseInput.inputs.filter((entry) => entry.target.startsWith("source/"))) {
    const expectedUri = `file:${sourceInput.target}`;
    const material = dependencies.find((candidate) => {
      return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate) && candidate.uri === expectedUri;
    });
    if (material === undefined) fail(`provenance source material is missing: ${sourceInput.target}`);
    const materialDigest = asObject(material.digest, `provenance digest for ${sourceInput.target}`);
    if (materialDigest.sha256 !== sourceInput.sha256) {
      fail(`provenance source material digest is not trusted: ${sourceInput.target}`);
    }
  }

  const runDetails = asObject(predicate.runDetails, "provenance runDetails");
  assertExactKeys(runDetails, ["builder", "metadata"], "provenance runDetails");
  const builder = asObject(runDetails.builder, "provenance runDetails.builder");
  if (
    builder.id !== "https://invariantcad.dev/builders/rootless-podman-occt-facade/v1" ||
    builder.image !== "ghcr.io/andymai/occt-wasm-builder@sha256:d4d9b7232c92eda68e478aba5bbf1e8880e0f6c8aeeee627d8296f994642848b" ||
    builder.platform !== "linux/amd64"
  ) {
    fail("provenance builder does not match the digest-pinned build boundary");
  }
  const metadata = asObject(runDetails.metadata, "provenance runDetails.metadata");
  assertExactKeys(
    metadata,
    [
      "buildExecutionObserved",
      "buildExecutionAuthenticated",
      "archiveNormalization",
    ],
    "provenance runDetails.metadata",
  );
  if (
    metadata.buildExecutionObserved !== false ||
    metadata.buildExecutionAuthenticated !== false ||
    metadata.archiveNormalization !==
      "GNU ustar with bytewise path order, epoch-zero timestamps, numeric root ownership, normalized modes, and gzip -n -9"
  ) {
    fail("provenance run metadata must preserve the unobserved, unauthenticated build boundary");
  }
  const limitations = asObject(predicate.limitations, "provenance limitations");
  if (
    limitations.signed !== false ||
    typeof limitations.statement !== "string" ||
    !limitations.statement.includes("did not observe or authenticate")
  ) {
    fail("provenance limitations must disclose the unsigned, unobserved build boundary");
  }
  if (!JSON.stringify(provenance).includes(asObject(release.facade, "release.facade").marker)) {
    fail("provenance does not identify the facade ABI marker");
  }
  void files;
  void releaseInput;
}

async function verifyBundle(inputPath, trustedRuntime, trustedReleaseInput) {
  const releaseInput = trustedReleaseInput === undefined
    ? await readTrustedReleaseInput()
    : validateReleaseInput(trustedReleaseInput);
  const collected = await collectInput(
    inputPath,
    trustedRuntime === undefined ? releaseInput.archive : undefined,
  );
  assertExactSet([...collected.files.keys()].sort(compareBytewise), EXPECTED_FILE_PATHS, "bundle files");
  const uniqueDirectories = [...new Set(collected.directories)].sort(compareBytewise);
  if (uniqueDirectories.length !== collected.directories.length) fail("bundle contains duplicate directory entries");
  const unexpectedDirectories = uniqueDirectories.filter((path) => !EXPECTED_DIRECTORIES.includes(path));
  if (unexpectedDirectories.length > 0) {
    fail(`bundle contains unexpected directories: ${unexpectedDirectories.join(", ")}`);
  }
  const manifest = parseManifest(collected.files);
  const runtimePins = verifyPinnedPayload(
    collected.files,
    releaseInput,
    trustedRuntime,
  );
  const release = verifyRelease(
    collected.files,
    manifest,
    releaseInput,
    runtimePins,
  );
  const lock = verifySourceInputs(collected.files);
  verifyLicenses(collected.files);
  verifySbom(collected.files, manifest, runtimePins, releaseInput, lock);
  verifyProvenance(
    collected.files,
    manifest,
    release,
    releaseInput,
    runtimePins,
    lock,
  );
  return Object.freeze({
    ok: true,
    format: collected.format,
    inputPath: collected.inputPath,
    bundleRoot: collected.bundleRoot,
    name: BUNDLE_NAME,
    version: BUNDLE_VERSION,
    facadeMarker: FACADE_MARKER,
    fileCount: collected.files.size,
    manifestSha256: sha256(collected.files.get("SHA256SUMS")),
    ...(collected.archiveSha256 === undefined
      ? {}
      : { archiveSha256: collected.archiveSha256 }),
  });
}

export async function verifyOcctFacadeBundle(inputPath) {
  return verifyBundle(inputPath, undefined);
}

export async function verifyOcctFacadeBundleWithTestRuntime(
  inputPath,
  trustedRuntime,
  trustedReleaseInput,
) {
  if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
    fail("the synthetic-runtime verifier is available only under a test runner");
  }
  return verifyBundle(inputPath, trustedRuntime, trustedReleaseInput);
}

function usage() {
  return `Usage: node scripts/verify-occt-facade-bundle.mjs [--json] PATH

Verify the complete InvariantCAD OCCT facade 0.9.0 compliance bundle at PATH.
PATH must be the versioned bundle directory or its deterministic .tar.gz archive.

Options:
  --json   Print one machine-readable JSON result, including bundleRoot.
  -h, --help
           Show this help.
`;
}

async function main(argv) {
  let json = false;
  let inputPath;
  for (const argument of argv) {
    if (argument === "--json") {
      json = true;
    } else if (argument === "-h" || argument === "--help") {
      process.stdout.write(usage());
      return;
    } else if (argument.startsWith("-")) {
      fail(`unknown option: ${argument}`);
    } else if (inputPath === undefined) {
      inputPath = argument;
    } else {
      fail("exactly one bundle path is required");
    }
  }
  if (inputPath === undefined) fail("a bundle directory or .tar.gz path is required");
  const result = await verifyOcctFacadeBundle(inputPath);
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    process.stdout.write(
      `[occt-facade-bundle] verified ${result.name}@${result.version} (${result.format}) at ${result.bundleRoot}\n`,
    );
  }
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `[occt-facade-bundle] verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
