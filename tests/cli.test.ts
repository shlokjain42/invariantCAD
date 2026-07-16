import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { design, mm, stringifyDocument, vec3 } from "../src/index.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

describe("CLI", () => {
  it("prints help successfully when --help is the first argument", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "--help"],
      { cwd: projectRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("InvariantCAD CLI");
    expect(result.stdout).toContain("invariantcad export");
  });

  it("selects the exact kernel automatically for STEP export", async () => {
    const directory = await mkdtemp(join(tmpdir(), "invariantcad-cli-"));
    try {
      const cad = design("cli-step");
      cad.output(
        "solid",
        cad.box("solid", { size: vec3(mm(2), mm(3), mm(4)) }),
      );
      const documentPath = join(directory, "model.json");
      const outputPath = join(directory, "model.step");
      await writeFile(documentPath, stringifyDocument(cad.build()));
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "export",
          documentPath,
          "--to",
          outputPath,
        ],
        { cwd: projectRoot, encoding: "utf8" },
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.trim()).toBe(`Wrote ${outputPath}`);
      expect((await stat(outputPath)).size).toBeGreaterThan(100);
      expect(await readFile(outputPath, "utf8")).toContain("ISO-10303-21");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
