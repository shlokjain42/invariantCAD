import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";

const sourceDirectory = new URL("../src/vendor/manifold-3d/", import.meta.url);
const destinationDirectory = new URL("../dist/vendor/manifold-3d/", import.meta.url);
const noticeSourceDirectory = new URL("../licenses/", import.meta.url);
const noticeDestinationDirectory = new URL("licenses/", destinationDirectory);

const expected = Object.freeze({
  "manifold.js": Object.freeze({
    bytes: 74_762,
    sha256: "860b5c9702a807d1f93b9eb5b4fce15dd1de1af35c508301791986bc4e70c552",
  }),
  "manifold.wasm": Object.freeze({
    bytes: 541_470,
    sha256: "73e3b419ad31294f6b1cc478173944e50efc4a34bfdeeff0107bdfc12975f11c",
  }),
  "manifold.d.ts": Object.freeze({
    bytes: 61_454,
    sha256: "bdbe14957171913daf8cf11856090e935d6c4a096ae21f16ef1850dcbfc03ffd",
  }),
  LICENSE: Object.freeze({
    bytes: 11_357,
    sha256: "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4",
  }),
});

const expectedNotices = Object.freeze({
  "manifold-Clipper2-Boost-1.0.txt": Object.freeze({
    bytes: 1_338,
    sha256: "c9bff75738922193e67fa726fa225535870d2aa1059f91452c411736284ad566",
  }),
  "manifold-Emscripten-5.0.2.txt": Object.freeze({
    bytes: 5_093,
    sha256: "620a78084fc7ca97c0b5dea9abf891f3ffcadfdbf305276f099c9c4e12fc1d86",
  }),
  "manifold-LLVM-exception.txt": Object.freeze({
    bytes: 16_703,
    sha256: "539dd7aed86e8a4f12cbdd0e6c50c189c7d74847e4fecc64ce2c6ee3a01da38b",
  }),
  "manifold-PhysX-BSD-3-Clause.txt": Object.freeze({
    bytes: 1_644,
    sha256: "28ec1501524c63cb608a94c6565fcc66cb9f40505aa4dee965e198c5d75e96a9",
  }),
  "manifold-Sun-msun.txt": Object.freeze({
    bytes: 251,
    sha256: "66d8887eacdccca70cbbd38e5c66ca569836d4e4af4f9c28c93fa73be9b7d28e",
  }),
  "manifold-compiler-rt-LICENSE.txt": Object.freeze({
    bytes: 16_708,
    sha256: "1a8f1058753f1ba890de984e48f0242a3a5c29a6a8f2ed9fd813f36985387e8d",
  }),
  "manifold-dset-zlib.txt": Object.freeze({
    bytes: 946,
    sha256: "b8eec0d78f28e86eca8c7dc3f80da4793ffdac001c09f06d48b06d6940d31c14",
  }),
  "manifold-dlmalloc-public-domain.txt": Object.freeze({
    bytes: 297,
    sha256: "bc57f80a7b0f53c8108ca5f967c2f76261c1a9685c744b5bd49fc0353275db06",
  }),
  "manifold-libcxxabi-LICENSE.txt": Object.freeze({
    bytes: 16_706,
    sha256: "e2b35be49f7284a45b7baca8fc7b3ab7440e7902392b2528a457816b5bb2a15c",
  }),
  "manifold-linalg-Unlicense.txt": Object.freeze({
    bytes: 1_538,
    sha256: "a9a49b23a77446e4117d9a2ea4c636dec2300f62e94f0bf3f063bb2a7277d5e1",
  }),
  "manifold-llvm-libc-LICENSE.txt": Object.freeze({
    bytes: 15_140,
    sha256: "ebcd9bbf783a73d05c53ba4d586b8d5813dcdf3bbec50265860ccc885e606f47",
  }),
  "manifold-musl-COPYRIGHT.txt": Object.freeze({
    bytes: 6_204,
    sha256: "f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af",
  }),
  "manifold-quickhull-public-domain.txt": Object.freeze({
    bytes: 243,
    sha256: "ab099527abde8da595dd2581884bbc6a62fc100cc5d75cb1384256549239001a",
  }),
  "manifold-tbtSVD-MIT.txt": Object.freeze({
    bytes: 1_099,
    sha256: "440e0039b26b029c189a2e4e05e168aafa13820d47d7fab883281b55ceeda300",
  }),
});

const manifestUrl = new URL("UPSTREAM.json", sourceDirectory);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
const buildIdentity = createHash("sha256")
  .update(JSON.stringify(manifest.build))
  .digest("hex");
const componentIdentity = createHash("sha256")
  .update(JSON.stringify(manifest.embeddedComponents))
  .digest("hex");
const expectedNoticeNames = Object.keys(expectedNotices).sort();
const declaredNoticeNames = Object.keys(manifest.notices ?? {}).sort();
const componentNoticeNames = (manifest.embeddedComponents ?? [])
  .map((component) => component.notice)
  .sort();
if (
  manifest.schemaVersion !== 1 ||
  manifest.package !== "manifold-3d" ||
  manifest.version !== "3.5.1" ||
  manifest.npmTarball !==
    "https://registry.npmjs.org/manifold-3d/-/manifold-3d-3.5.1.tgz" ||
  manifest.npmIntegrity !==
    "sha512-/+m6kxYMMhnPutcQ5oSmFJiJ+gyP/0fmuUCb9Qeaunvecm/bfqogKYDDJarsnWiFioSMtKheF+lGmSlnYCik9g==" ||
  manifest.npmAttestation !==
    "https://registry.npmjs.org/-/npm/v1/attestations/manifold-3d@3.5.1" ||
  manifest.tag !== "v3.5.1" ||
  manifest.tagCommit !== "cc8a7f66d7d5a560da94346258c5b546af27811e" ||
  manifest.license !== "Apache-2.0" ||
  manifest.build?.emscriptenVersion !== "5.0.2" ||
  manifest.build?.emscriptenCommit !==
    "dc80f645ee70178c11666de0c3860d9e064d50e4" ||
  manifest.build?.emsdkTagCommit !==
    "c817c0ca4ba889ee24a185fd954cff7de1bd8afa" ||
  manifest.build?.emscriptenReleasesCommit !==
    "0a320d2395858e63288b3632b81535444ca2c59d" ||
  manifest.build?.llvmCommit !==
    "58f4da463e5b3cd3531cace17cc3f2d8d860964e" ||
  manifest.build?.binaryenCommit !==
    "f538edcd79e739e68bdbe6bdf7a62e3ec5ccaeed" ||
  manifest.build?.buildType !== "MinSizeRel" ||
  manifest.build?.strict !== true ||
  manifest.build?.debug !== false ||
  manifest.build?.assertions !== false ||
  manifest.build?.parallel !== false ||
  manifest.build?.workflowRunId !== 26_954_086_564 ||
  manifest.build?.sourceCommit !==
    "cc8a7f66d7d5a560da94346258c5b546af27811e" ||
  manifest.build?.artifactId !== 7_412_602_752 ||
  manifest.build?.artifactArchiveDigest !==
    "sha256:48c480a83c2c3852f57f48c51285481183086a4376bc02ee22c2dce03b56399b" ||
  manifest.build?.clipper2Commit !==
    "46f639177fe418f9689e8ddb74f08a870c71f5b4" ||
  manifest.embeddedComponents?.length !== 14 ||
  buildIdentity !==
    "dfcfbb2ba47c3416909124b2fcde9ae820491f39bdde91504dde43817331518c" ||
  componentIdentity !==
    "1ff74261c3bbf7abd6821d2d962e42d7ac4fdfab24fe574c700e579fef82f4cd" ||
  JSON.stringify(declaredNoticeNames) !== JSON.stringify(expectedNoticeNames) ||
  JSON.stringify(componentNoticeNames) !== JSON.stringify(expectedNoticeNames)
) {
  throw new Error("The vendored Manifold provenance manifest is unsupported");
}

await mkdir(destinationDirectory, { recursive: true });
await mkdir(noticeDestinationDirectory, { recursive: true });

for (const [name, identity] of Object.entries(expected)) {
  const source = new URL(name, sourceDirectory);
  const bytes = await readFile(source);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const declared = manifest.artifacts?.[name];
  if (
    bytes.byteLength !== identity.bytes ||
    digest !== identity.sha256 ||
    declared?.bytes !== identity.bytes ||
    declared?.sha256 !== identity.sha256
  ) {
    throw new Error(
      `Vendored Manifold artifact ${name} does not match the reviewed 3.5.1 identity`,
    );
  }
  await copyFile(source, new URL(name, destinationDirectory));
}

for (const [name, identity] of Object.entries(expectedNotices)) {
  const source = new URL(name, noticeSourceDirectory);
  const bytes = await readFile(source);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const declared = manifest.notices?.[name];
  if (
    bytes.byteLength !== identity.bytes ||
    digest !== identity.sha256 ||
    declared?.bytes !== identity.bytes ||
    declared?.sha256 !== identity.sha256
  ) {
    throw new Error(
      `Vendored Manifold notice ${name} does not match the reviewed identity`,
    );
  }
  await copyFile(source, new URL(name, noticeDestinationDirectory));
}

await copyFile(manifestUrl, new URL("UPSTREAM.json", destinationDirectory));
console.log(
  "Verified and staged the pinned Manifold 3.5.1 core runtime and notices.",
);
