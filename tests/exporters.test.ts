import { describe, expect, it } from "vitest";
import { exportBinaryStl, exportMesh, type MeshData } from "../src/index.js";

const EMPTY: MeshData = {
  positions: new Float32Array(),
  indices: new Uint32Array(),
};

const TRIANGLE: MeshData = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  indices: new Uint32Array([0, 1, 2]),
};

function headerText(bytes: Uint8Array): string {
  const header = bytes.subarray(0, 80);
  const end = header.indexOf(0);
  return new TextDecoder("utf-8", { fatal: true }).decode(
    end === -1 ? header : header.subarray(0, end),
  );
}

describe("binary STL header", () => {
  it("writes short ASCII names unchanged", () => {
    const bytes = exportBinaryStl(TRIANGLE, "bracket");
    expect(bytes.byteLength).toBe(84 + 50);
    expect(headerText(bytes)).toBe("bracket");
    expect(new DataView(bytes.buffer).getUint32(80, true)).toBe(1);
  });

  it.each([
    ["an empty mesh", EMPTY, 84],
    ["a one-triangle mesh", TRIANGLE, 134],
  ] as const)(
    "keeps a long multi-byte name inside the 80-byte header for %s",
    (_label, mesh, length) => {
      const name = "部".repeat(80);
      const bytes = exportBinaryStl(mesh, name);
      expect(bytes.byteLength).toBe(length);
      // 26 three-byte characters fit; the 27th would end at byte 81.
      expect(headerText(bytes)).toBe("部".repeat(26));
      expect(bytes[78]).toBe(0);
      expect(new DataView(bytes.buffer).getUint32(80, true)).toBe(
        mesh.indices.length / 3,
      );
    },
  );

  it("never splits a multi-byte character at the header boundary", () => {
    for (let prefix = 70; prefix <= 80; prefix += 1) {
      const bytes = exportBinaryStl(TRIANGLE, `${"a".repeat(prefix)}😀tail`);
      const text = headerText(bytes);
      expect(text.startsWith("a".repeat(Math.min(prefix, 80)))).toBe(true);
      expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(80);
    }
  });

  it.each(["solid", "Solid-bracket", "  SOLID body", "solidity"])(
    "does not start the header of %j with 'solid'",
    (name) => {
      const bytes = exportMesh(TRIANGLE, "stl", name);
      const text = headerText(bytes);
      expect(text.trimStart().slice(0, 5).toLowerCase()).not.toBe("solid");
      expect(text).toBe(`InvariantCAD: ${name}`);
    },
  );
});
