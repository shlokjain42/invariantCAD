import { access, readFile, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const lockUrl = new URL("../native/occt/upstream.lock.json", import.meta.url);
const scriptUrl = new URL("../scripts/build-occt-facade.sh", import.meta.url);
const draftPatchUrl = new URL(
  "../native/occt/patches/0001-atomic-multi-face-draft.patch",
  import.meta.url,
);
const historyPatchUrl = new URL(
  "../native/occt/patches/0002-indexed-draft-history.patch",
  import.meta.url,
);
const pipeShellPatchUrl = new URL(
  "../native/occt/patches/0003-controlled-pipe-shell.patch",
  import.meta.url,
);
const booleanPatchUrl = new URL(
  "../native/occt/patches/0004-exact-boolean-history.patch",
  import.meta.url,
);
const edgeTreatmentPatchUrl = new URL(
  "../native/occt/patches/0005-exact-edge-treatment-history.patch",
  import.meta.url,
);
const solidOffsetPatchUrl = new URL(
  "../native/occt/patches/0006-exact-solid-offset-history.patch",
  import.meta.url,
);
const artifactPatchUrl = new URL(
  "../native/occt/patches/0007-bounded-shape-artifacts.patch",
  import.meta.url,
);
const hardenedArtifactPatchUrl = new URL(
  "../native/occt/patches/0008-hardened-shape-artifact-budgets.patch",
  import.meta.url,
);
const artifactPreflightPatchUrl = new URL(
  "../native/occt/patches/0009-bintools-v4-structural-preflight.patch",
  import.meta.url,
);
const smokeUrl = new URL("../scripts/test-occt-facade.mjs", import.meta.url);
const packagerUrl = new URL(
  "../scripts/package-occt-facade-bundle.mjs",
  import.meta.url,
);
const releaseInputUrl = new URL(
  "../native/occt/bundle/release-input.json",
  import.meta.url,
);
const patchDirectoryUrl = new URL("../native/occt/patches/", import.meta.url);

describe("owned OCCT facade build boundary", () => {
  it("pins every upstream and toolchain input to the audited baseline", async () => {
    const lock = JSON.parse(await readFile(lockUrl, "utf8")) as {
      schemaVersion: number;
      upstream: { tag: string; commit: string };
      occt: { commit: string };
      toolchain: { emscripten: string; rust: string };
      builder: { digest: string; platform: string };
    };

    expect(lock).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        upstream: expect.objectContaining({
          tag: "v3.8.0",
          commit: "cf37f4dad07adbc2691f2122a6461a87c7acd748",
        }),
        occt: {
          commit: "c16749358fff7c2fef240096a628e0d4050dc0d4",
          repository: "https://github.com/andymai/OCCT.git",
        },
        toolchain: { emscripten: "5.0.3", rust: "1.95" },
        builder: expect.objectContaining({
          digest:
            "sha256:bac126c570537bd8100da368ee30845d8d267ce4b14776bfd68c5afed22ad859",
          platform: "linux/amd64",
        }),
      }),
    );
  });

  it("keeps the build entry point executable, syntactically valid, and offline", async () => {
    await access(scriptUrl, constants.X_OK);
    expect((await stat(scriptUrl)).mode & 0o111).not.toBe(0);

    const syntax = spawnSync("bash", ["-n", scriptUrl.pathname], {
      encoding: "utf8",
    });
    expect(syntax.status, syntax.stderr).toBe(0);

    const help = spawnSync(scriptUrl.pathname, ["--help"], {
      encoding: "utf8",
    });
    expect(help.status, help.stderr).toBe(0);
    expect(help.stdout).toContain("--skip-fetch");

    const source = await readFile(scriptUrl, "utf8");
    expect(source).toContain("--network=none");
    expect(source).toContain("--cap-drop=all");
    expect(source).toContain("--security-opt=no-new-privileges");
    expect(source).toContain("CARGO_NET_OFFLINE=true");
    expect(source).not.toContain(":latest");
  });

  it("tracks the complete ordered owned-facade patch ABI", async () => {
    const draftPatch = await readFile(draftPatchUrl, "utf8");
    expect(draftPatch).toContain("invariantcadDraftFacesAtomic");
    expect(draftPatch).toContain("ANGLE_BELOW_KERNEL_LIMIT");
    expect(draftPatch).toContain("transferCode");

    const historyPatch = await readFile(historyPatchUrl, "utf8");
    expect(historyPatch).toContain("InvariantCadIndexedTopologyEvolution");
    expect(historyPatch).toContain("topologyHistoryComplete");
    expect(historyPatch).toContain("enum_value_type::number");
    expect(historyPatch).toContain(
      "const TopoDS_Shape& canonicalResult = result.FindKey",
    );
    expect(historyPatch).toContain("source.IsEqual(canonicalResult)");
    expect(historyPatch).toContain("HISTORY_NON_INJECTIVE");
    expect(historyPatch).toContain(
      "InvariantCadDraftReport(InvariantCadDraftReport&&) noexcept",
    );

    const pipeShellPatch = await readFile(pipeShellPatchUrl, "utf8");
    expect(pipeShellPatch).toContain("InvariantCadPipeShellReport");
    expect(pipeShellPatch).toContain("invariantcadPipeShellSolid");
    expect(pipeShellPatch).toContain(
      "invariantcad-facade@0.3.0+occt-wasm.3.8.0",
    );

    const booleanPatch = await readFile(booleanPatchUrl, "utf8");
    expect(booleanPatch).toContain("InvariantCadBooleanReport");
    expect(booleanPatch).toContain("invariantcadBooleanAtomic");
    expect(booleanPatch).toContain("BRepTools_History");
    expect(booleanPatch).toContain("BRepBuilderAPI_Copy");
    expect(booleanPatch).toContain("HISTORY_COPY_SUCCESSOR_NOT_UNIQUE");
    expect(booleanPatch).toContain("InvariantCadTopologyRelationCreated");
    expect(booleanPatch).toContain("SetNonDestructive(true)");
    expect(booleanPatch).toContain("HISTORY_RECORD_LIMIT_EXCEEDED");
    expect(booleanPatch).toContain("maxHistoryRecords");
    expect(booleanPatch).toContain(
      "invariantcad-facade@0.4.0+occt-wasm.3.8.0",
    );

    const edgeTreatmentPatch = await readFile(edgeTreatmentPatchUrl, "utf8");
    expect(edgeTreatmentPatch).toContain("InvariantCadEdgeTreatmentReport");
    expect(edgeTreatmentPatch).toContain("invariantcadEdgeTreatmentAtomic");
    expect(edgeTreatmentPatch).toContain("BRepFilletAPI_MakeFillet");
    expect(edgeTreatmentPatch).toContain("BRepFilletAPI_MakeChamfer");
    expect(edgeTreatmentPatch).toContain("BRepTools_History");
    expect(edgeTreatmentPatch).toContain(
      "BRepBuilderAPI_Copy>(inputSolid, true, false)",
    );
    expect(edgeTreatmentPatch).toContain("maker.Contour");
    expect(edgeTreatmentPatch).toContain("skippedSeedCount");
    expect(edgeTreatmentPatch).toContain("buildEdgeTreatmentTopologyHistory");
    expect(edgeTreatmentPatch).toContain("maxHistoryRecords");
    expect(edgeTreatmentPatch).toContain(
      "invariantcad-facade@0.5.0+occt-wasm.3.8.0",
    );

    const solidOffsetPatch = await readFile(solidOffsetPatchUrl, "utf8");
    expect(solidOffsetPatch).toContain("InvariantCadSolidOffsetReport");
    expect(solidOffsetPatch).toContain("invariantcadSolidOffsetAtomic");
    expect(solidOffsetPatch).toContain("BRepOffsetAPI_MakeThickSolid");
    expect(solidOffsetPatch).toContain("BRepOffsetAPI_MakeOffsetShape");
    expect(solidOffsetPatch).toContain("BRepTools_History");
    expect(solidOffsetPatch).toContain("reconcileGeneratedOnlyReplacements");
    expect(solidOffsetPatch).toContain("maxHistoryRecords");
    expect(solidOffsetPatch).toContain(
      "invariantcad-facade@0.6.0+occt-wasm.3.8.0",
    );

    const artifactPatch = await readFile(artifactPatchUrl, "utf8");
    expect(artifactPatch).toContain("BoundedArtifactOutputBuffer");
    expect(artifactPatch).toContain("InvariantCadArtifactWriteReport");
    expect(artifactPatch).toContain("InvariantCadArtifactReadReport");
    expect(artifactPatch).toContain("invariantcadWriteArtifactBrep");
    expect(artifactPatch).toContain("invariantcadReadArtifactBrep");
    expect(artifactPatch).toContain("OUTPUT_LIMIT_EXCEEDED");
    expect(artifactPatch).toContain("TOPOLOGY_LIMIT_EXCEEDED");
    expect(artifactPatch).toContain("BinTools_FormatVersion_VERSION_4");
    expect(artifactPatch).toContain(
      "invariantcad-facade@0.7.0+occt-wasm.3.8.0",
    );

    const hardenedArtifactPatch = await readFile(
      hardenedArtifactPatchUrl,
      "utf8",
    );
    expect(hardenedArtifactPatch).toContain(
      "invariantcad_allocation_budget.h",
    );
    expect(hardenedArtifactPatch).toContain(
      "invariantcad_allocation_budget.cpp",
    );
    for (const allocatorSymbol of [
      "_ZN8Standard8AllocateEm",
      "_ZN8Standard15AllocateOptimalEm",
      "_ZN8Standard10ReallocateEPvm",
      "_ZN8Standard15AllocateAlignedEmm",
      "_Znwm",
      "_Znam",
      "malloc",
      "calloc",
      "realloc",
      "posix_memalign",
      "aligned_alloc",
      "memalign",
    ]) {
      expect(hardenedArtifactPatch).toContain(`--wrap=${allocatorSymbol}`);
    }
    expect(hardenedArtifactPatch).toContain("maxNativeRequestedBytes");
    expect(hardenedArtifactPatch).toContain("nativeRequestedBytes");
    expect(hardenedArtifactPatch).toContain("nativeAllocationCalls");
    expect(hardenedArtifactPatch).toContain("nativeRequestLimitExceeded");
    expect(hardenedArtifactPatch).toContain(
      "NATIVE_REQUEST_LIMIT_EXCEEDED",
    );
    expect(hardenedArtifactPatch).toContain(
      "invariantcad-facade@0.8.0+occt-wasm.3.8.0",
    );

    const artifactPreflightPatch = await readFile(
      artifactPreflightPatchUrl,
      "utf8",
    );
    expect(artifactPreflightPatch).toContain(
      "invariantcad_bintools_v4_preflight.h",
    );
    expect(artifactPreflightPatch).toContain(
      "invariantcad_bintools_v4_preflight.cpp",
    );
    expect(artifactPreflightPatch).toContain(
      "Open CASCADE Topology V4",
    );
    expect(artifactPreflightPatch).toContain("maxPreflightWorkUnits");
    expect(artifactPreflightPatch).toContain("maxPreflightNestingDepth");
    expect(artifactPreflightPatch).toContain("maxPreflightLocationPower");
    expect(artifactPreflightPatch).toContain("ShapeMetrics");
    expect(artifactPreflightPatch).toContain("expandedOccurrences");
    expect(artifactPreflightPatch).toContain(
      "Owned writer location table contains no duplicate chains",
    );
    expect(artifactPreflightPatch).toContain("archivePreflightComplete");
    expect(artifactPreflightPatch).toContain("deserializationStarted");
    expect(artifactPreflightPatch).toContain(
      "invariantcad-facade@0.9.0+occt-wasm.3.8.0",
    );

    const releaseInput = JSON.parse(await readFile(releaseInputUrl, "utf8")) as {
      inputs: Array<{ source: string; role: string }>;
    };
    const pinnedPatchNames = releaseInput.inputs
      .filter((entry) => entry.role === "source-patch")
      .map((entry) => entry.source.split("/").at(-1));
    const actualPatchNames = (await readdir(patchDirectoryUrl, {
      withFileTypes: true,
    }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".patch"))
      .map((entry) => entry.name)
      .sort();
    expect(pinnedPatchNames).toEqual(actualPatchNames);

    const packager = await readFile(packagerUrl, "utf8");
    expect(packager).toContain("does not exactly match bytewise build series");
    expect(packager).toContain(
      "await readdir(PATCH_DIRECTORY, { withFileTypes: true })",
    );

    const syntax = spawnSync(process.execPath, ["--check", smokeUrl.pathname], {
      encoding: "utf8",
    });
    expect(syntax.status, syntax.stderr).toBe(0);
  });
});
