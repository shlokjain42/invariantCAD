import { access, readFile, stat } from "node:fs/promises";
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
const smokeUrl = new URL("../scripts/test-occt-facade.mjs", import.meta.url);

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
          tag: "v3.7.0",
          commit: "fe3d5effdaa1ca9a4007a86fde46abd62722fbba",
        }),
        occt: {
          commit: "6e1fe656bf028bf0004482c389661587b269fc65",
          repository: "https://github.com/andymai/OCCT.git",
        },
        toolchain: { emscripten: "5.0.3", rust: "1.95" },
        builder: expect.objectContaining({
          digest:
            "sha256:d4d9b7232c92eda68e478aba5bbf1e8880e0f6c8aeeee627d8296f994642848b",
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

  it("tracks the hardened draft extension and its exact indexed history ABI", async () => {
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

    const syntax = spawnSync(process.execPath, ["--check", smokeUrl.pathname], {
      encoding: "utf8",
    });
    expect(syntax.status, syntax.stderr).toBe(0);
  });
});
