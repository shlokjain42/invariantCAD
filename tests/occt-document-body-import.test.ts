import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OcctKernel as RawOcctKernel,
  type ShapeHandle,
} from "occt-wasm";
import {
  KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
  type GeometryKernel,
  type KernelDocumentBodyImportOptions,
} from "../src/index.js";
import { createOcctKernel } from "../src/occt-kernel.js";

interface ImportFixtures {
  readonly brep: Uint8Array;
  readonly brepBinary: Uint8Array;
  readonly step: Uint8Array;
  readonly centimeterStep: Uint8Array;
  readonly nestedBrep: Uint8Array;
  readonly reversedBrep: Uint8Array;
  readonly multipleSolidsBrep: Uint8Array;
  readonly looseTopologyBrep: Uint8Array;
  readonly faceOnlyBrep: Uint8Array;
}

const encoder = new TextEncoder();

async function createFixtures(): Promise<ImportFixtures> {
  const raw = await RawOcctKernel.init();
  const owned: ShapeHandle[] = [];
  const own = (handle: ShapeHandle): ShapeHandle => {
    owned.push(handle);
    return handle;
  };
  let faceHandles: ShapeHandle[] = [];
  try {
    const box = own(raw.makeBox(2, 3, 4));
    const translated = own(raw.translate(box, 10, 0, 0));
    const inner = own(raw.makeCompound([box]));
    const outer = own(raw.makeCompound([inner]));
    const reversed = own(raw.reverseShape(box));
    const multiple = own(raw.makeCompound([box, translated]));
    faceHandles = raw.getSubShapes(translated, "face");
    const loose = own(raw.makeCompound([box, faceHandles[0]!]));

    const stepText = raw.exportStep(box);
    const centimeterStep = stepText.replaceAll(".MILLI.", ".CENTI.");
    if (centimeterStep === stepText) {
      throw new Error("OCCT STEP fixture did not declare millimeter units");
    }
    return {
      brep: encoder.encode(raw.toBREP(box)),
      brepBinary: raw.toBREPBinary(box).slice(),
      step: encoder.encode(stepText),
      centimeterStep: encoder.encode(centimeterStep),
      nestedBrep: encoder.encode(raw.toBREP(outer)),
      reversedBrep: encoder.encode(raw.toBREP(reversed)),
      multipleSolidsBrep: encoder.encode(raw.toBREP(multiple)),
      looseTopologyBrep: encoder.encode(raw.toBREP(loose)),
      faceOnlyBrep: encoder.encode(raw.toBREP(faceHandles[0]!)),
    };
  } finally {
    for (let index = faceHandles.length - 1; index >= 0; index -= 1) {
      raw.release(faceHandles[index]!);
    }
    for (let index = owned.length - 1; index >= 0; index -= 1) {
      raw.release(owned[index]!);
    }
    raw[Symbol.dispose]();
  }
}

const declared = (
  format: "brep" | "brep-binary",
  length: "mm" | "cm" | "m" | "in",
): KernelDocumentBodyImportOptions => ({
  format,
  units: { mode: "declared", length },
  healing: { mode: "none" },
});

const fromStep: KernelDocumentBodyImportOptions = {
  format: "step",
  units: { mode: "from-file" },
  healing: { mode: "none" },
};

function liveShapeCount(kernel: GeometryKernel): number {
  return (
    kernel as GeometryKernel & {
      readonly liveShapes: ReadonlySet<unknown>;
    }
  ).liveShapes.size;
}

function nativeHandleCount(kernel: GeometryKernel): number {
  return (
    kernel as GeometryKernel & {
      readonly raw: { readonly shapeCount: number };
    }
  ).raw.shapeCount;
}

describe("OCCT document-body import protocol", () => {
  let fixtures: ImportFixtures;
  let kernel: GeometryKernel;

  beforeAll(async () => {
    fixtures = await createFixtures();
    kernel = await createOcctKernel();
  }, 30_000);

  afterAll(() => {
    kernel.dispose();
  });

  it("advertises only the strong format and unit combinations it implements", () => {
    expect(kernel.capabilities.documentBodyImport).toEqual({
      protocolVersion: KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
      formats: [
        { format: "step", unitModes: ["from-file"] },
        { format: "brep", unitModes: ["declared"] },
        { format: "brep-binary", unitModes: ["declared"] },
      ],
    });
    expect(kernel.importDocumentBody).toBeTypeOf("function");
  });

  it("imports STEP units from the file and unitless BREP as declared", () => {
    for (const [bytes, options] of [
      [fixtures.step, fromStep],
      [fixtures.brep, declared("brep", "mm")],
      [fixtures.brepBinary, declared("brep-binary", "mm")],
    ] as const) {
      const imported = kernel.importDocumentBody!(bytes, options, {
        feature: "imported",
      });
      try {
        expect(kernel.status(imported)).toEqual({ ok: true, code: "VALID" });
        expect(kernel.measure(imported).volume).toBeCloseTo(24, 8);
        expect(kernel.topology!(imported).history).toBe("partial");
      } finally {
        kernel.disposeShape(imported);
      }
    }
  });

  it("honors a non-millimeter STEP file unit declaration", () => {
    const imported = kernel.importDocumentBody!(
      fixtures.centimeterStep,
      fromStep,
    );
    try {
      expect(kernel.measure(imported).volume).toBeCloseTo(24_000, 6);
      expect(kernel.measure(imported).boundingBox.max).toEqual([20, 30, 40]);
    } finally {
      kernel.disposeShape(imported);
    }
  });

  it("normalizes every declared BREP length unit to document millimeters", () => {
    for (const [length, scale] of [
      ["mm", 1],
      ["cm", 10],
      ["m", 1_000],
      ["in", 25.4],
    ] as const) {
      const imported = kernel.importDocumentBody!(
        fixtures.brep,
        declared("brep", length),
      );
      try {
        expect(kernel.measure(imported).volume).toBeCloseTo(
          24 * scale ** 3,
          5,
        );
        expect(kernel.measure(imported).boundingBox.max).toEqual([
          2 * scale,
          3 * scale,
          4 * scale,
        ]);
      } finally {
        kernel.disposeShape(imported);
      }
    }
  });

  it("unwraps a pure nested compound and normalizes reversed orientation", () => {
    for (const bytes of [fixtures.nestedBrep, fixtures.reversedBrep]) {
      const imported = kernel.importDocumentBody!(
        bytes,
        declared("brep", "mm"),
      );
      try {
        expect(kernel.measure(imported).volume).toBeCloseTo(24, 8);
        expect(kernel.topology!(imported).faces).toHaveLength(6);
      } finally {
        kernel.disposeShape(imported);
      }
    }
  });

  it("checks deeply nested compound ancestry without recursive stack growth", () => {
    const internal = kernel as unknown as {
      readonly raw: {
        getShapeType(handle: ShapeHandle): string;
        iterShapes(handle: ShapeHandle): ShapeHandle[];
        isSame(left: ShapeHandle, right: ShapeHandle): boolean;
        release(handle: ShapeHandle): void;
      };
      isPureSingleSolidShape(
        shape: ShapeHandle,
        solid: ShapeHandle,
      ): boolean;
    };
    const raw = internal.raw;
    const originalGetShapeType = raw.getShapeType.bind(raw);
    const originalIterShapes = raw.iterShapes.bind(raw);
    const originalIsSame = raw.isSame.bind(raw);
    const originalRelease = raw.release.bind(raw);
    const depth = 20_000;
    const handles = Array.from(
      { length: depth },
      (_, index) => ({ index }) as unknown as ShapeHandle,
    );
    let releases = 0;
    try {
      raw.getShapeType = (handle): string =>
        handle === handles.at(-1) ? "solid" : "compound";
      raw.iterShapes = (handle): ShapeHandle[] => {
        const index = (handle as unknown as { readonly index: number }).index;
        return [handles[index + 1]!];
      };
      raw.isSame = (left, right): boolean => left === right;
      raw.release = (): void => {
        releases += 1;
      };
      expect(
        internal.isPureSingleSolidShape(handles[0]!, handles.at(-1)!),
      ).toBe(true);
      expect(releases).toBe(depth - 1);
    } finally {
      raw.getShapeType = originalGetShapeType;
      raw.iterShapes = originalIterShapes;
      raw.isSame = originalIsSame;
      raw.release = originalRelease;
    }
  });

  it("rejects multiple solids, loose topology, and non-solid roots without leaks", () => {
    for (const bytes of [
      fixtures.multipleSolidsBrep,
      fixtures.looseTopologyBrep,
      fixtures.faceOnlyBrep,
    ]) {
      const before = liveShapeCount(kernel);
      const nativeBefore = nativeHandleCount(kernel);
      expect(() =>
        kernel.importDocumentBody!(bytes, declared("brep", "mm")),
      ).toThrow(/exactly one solid|positive-volume solid/);
      expect(liveShapeCount(kernel)).toBe(before);
      expect(nativeHandleCount(kernel)).toBe(nativeBefore);
    }
  });

  it("rejects invalid UTF-8 and unsupported option combinations before adoption", () => {
    expect(() =>
      kernel.importDocumentBody!(
        new Uint8Array([0xc3, 0x28]),
        declared("brep", "mm"),
      ),
    ).toThrow();

    const invalidOptions = [
      {
        format: "step",
        units: { mode: "declared", length: "mm" },
        healing: { mode: "none" },
      },
      {
        format: "brep",
        units: { mode: "from-file" },
        healing: { mode: "none" },
      },
      {
        format: "brep",
        units: { mode: "declared", length: "ft" },
        healing: { mode: "none" },
      },
      {
        format: "brep",
        units: { mode: "declared", length: "mm" },
        healing: { mode: "automatic" },
      },
    ];
    for (const options of invalidOptions) {
      expect(() =>
        kernel.importDocumentBody!(
          fixtures.brep,
          options as unknown as KernelDocumentBodyImportOptions,
        ),
      ).toThrow(/units|requires|healing/);
    }
  });

  it("rejects shared bytes and releases a parsed root when cancellation wins", () => {
    if (typeof SharedArrayBuffer !== "undefined") {
      expect(() =>
        kernel.importDocumentBody!(
          new Uint8Array(new SharedArrayBuffer(fixtures.brep.byteLength)),
          declared("brep", "mm"),
        ),
      ).toThrow(/shared storage/);
    }

    const raw = (
      kernel as GeometryKernel & {
        readonly raw: {
          fromBREP(value: string): ShapeHandle;
          release(handle: ShapeHandle): void;
        };
      }
    ).raw;
    const originalFromBrep = raw.fromBREP.bind(raw);
    const originalRelease = raw.release.bind(raw);
    const released: ShapeHandle[] = [];
    const controller = new AbortController();
    let parsed: ShapeHandle | undefined;
    const nativeBefore = nativeHandleCount(kernel);
    try {
      raw.fromBREP = (value: string): ShapeHandle => {
        parsed = originalFromBrep(value);
        controller.abort();
        return parsed;
      };
      raw.release = (handle: ShapeHandle): void => {
        released.push(handle);
        originalRelease(handle);
      };
      expect(() =>
        kernel.importDocumentBody!(
          fixtures.brep,
          declared("brep", "mm"),
          { signal: controller.signal },
        ),
      ).toThrow(expect.objectContaining({ name: "AbortError" }));
      expect(parsed).toBeDefined();
      expect(released).toContain(parsed);
      expect(liveShapeCount(kernel)).toBe(0);
      expect(nativeHandleCount(kernel)).toBe(nativeBefore);
    } finally {
      raw.fromBREP = originalFromBrep;
      raw.release = originalRelease;
    }
  });

  it("rejects a non-finite final native volume without adopting the shape", () => {
    const raw = (
      kernel as GeometryKernel & {
        readonly raw: {
          getVolume(handle: ShapeHandle): number;
        };
      }
    ).raw;
    const originalGetVolume = raw.getVolume.bind(raw);
    const nativeBefore = nativeHandleCount(kernel);
    let calls = 0;
    try {
      raw.getVolume = (handle: ShapeHandle): number => {
        calls += 1;
        return calls === 2 ? Number.POSITIVE_INFINITY : originalGetVolume(handle);
      };
      expect(() =>
        kernel.importDocumentBody!(
          fixtures.reversedBrep,
          declared("brep", "mm"),
        ),
      ).toThrow("positive-volume solid");
      expect(calls).toBe(2);
      expect(liveShapeCount(kernel)).toBe(0);
      expect(nativeHandleCount(kernel)).toBe(nativeBefore);
    } finally {
      raw.getVolume = originalGetVolume;
    }
  });
});
