import { describe, expect, it } from "vitest";
import type {
  OcctShapeArtifactCapturedSidecarState,
} from "../src/internal/occt-artifact-candidate.js";
import {
  decodeOcctArtifactSidecarV2,
  encodeOcctArtifactSidecarV2,
  OCCT_ARTIFACT_SIDECAR_V2_HEADER_BYTES,
  OCCT_ARTIFACT_SIDECAR_V2_MAX_BYTES,
} from "../src/internal/occt-artifact-sidecar-v2.js";
import type {
  KernelTopologyKey,
  KernelTopologyLineage,
} from "../src/protocol/topology.js";

const MAX_BYTES = OCCT_ARTIFACT_SIDECAR_V2_MAX_BYTES;

function topologyKey(value: string): KernelTopologyKey {
  return value as KernelTopologyKey;
}

function richState(canonicalInput = false): OcctShapeArtifactCapturedSidecarState {
  const face0 = topologyKey("source:face:0");
  const face1 = topologyKey("source:face:1");
  const edge0 = topologyKey("source:edge:0");
  const edge1 = topologyKey("source:edge:1");
  const vertex0 = topologyKey("source:vertex:0");
  const vertex1 = topologyKey("source:vertex:1");
  const globalA: KernelTopologyLineage = {
    feature: "a",
    relation: "created",
  };
  const globalB: KernelTopologyLineage = {
    feature: "b",
    relation: "created",
  };
  const faceCreated: KernelTopologyLineage = {
    feature: "face-created",
    relation: "created",
    role: "extrude.face.side",
    source: {
      kind: "sketch-entity",
      sketch: "profile",
      entity: "segment",
    },
  };
  const faceModified: KernelTopologyLineage = {
    feature: "face-modified",
    relation: "modified",
  };

  return {
    history: "partial",
    lineage: canonicalInput
      ? [globalA, globalB]
      : [globalB, globalA, globalA],
    volumeOverride: 12.5,
    nativeStructure: {
      rootType: "solid",
      rootOrientation: "forward",
      solidOrientations: ["forward"],
      shellOrientations: ["reversed"],
      wireOrientations: ["internal"],
      faceOrientations: ["forward", "reversed"],
      edgeOrientations: ["internal", "external"],
      vertexOrientations: ["forward", "reversed"],
    },
    topology: {
      history: "complete",
      faces: [
        {
          topology: "face",
          key: face0,
          area: 6,
          center: [1, 1.5, -0],
          bounds: { min: [0, 0, 0], max: [2, 3, 0] },
          surface: {
            kind: "plane",
            normal: [0, 0, 1],
            axis: [0, 1, 0],
            radius: 2,
          },
          lineage: canonicalInput
            ? [faceCreated, faceModified]
            : [faceModified, faceCreated, faceCreated],
          edges: canonicalInput ? [edge0, edge1] : [edge1, edge0],
        },
        {
          topology: "face",
          key: face1,
          area: 6,
          center: [1, 1.5, 1],
          bounds: { min: [0, 0, 1], max: [2, 3, 1] },
          surface: { kind: "plane", normal: [0, 0, -1] },
          lineage: [
            {
              feature: "face-end",
              relation: "created",
              role: "extrude.face.end-cap",
            },
          ],
          edges: [edge0],
        },
      ],
      edges: [
        {
          topology: "edge",
          key: edge0,
          length: 2,
          center: [1, 0, 0],
          bounds: { min: [0, 0, 0], max: [2, 0, 0] },
          curve: {
            kind: "circle",
            direction: [1, 0, 0],
            axis: [0, 0, 1],
            radius: 1,
          },
          lineage: [
            {
              feature: "edge-start",
              relation: "created",
              role: "extrude.edge.start-rim",
              source: {
                kind: "sketch-entity",
                sketch: "profile",
                entity: "segment",
              },
            },
          ],
          faces: canonicalInput ? [face0, face1] : [face1, face0],
          vertices: canonicalInput
            ? [vertex0, vertex1]
            : [vertex1, vertex0],
        },
        {
          topology: "edge",
          key: edge1,
          length: 3,
          center: [0, 1.5, 0],
          bounds: { min: [0, 0, 0], max: [0, 3, 0] },
          curve: { kind: "line", direction: [0, 1, 0] },
          lineage: [
            {
              feature: "edge-lateral",
              relation: "created",
              role: "extrude.edge.lateral",
            },
          ],
          faces: [face0],
          vertices: [],
        },
      ],
      vertices: [
        {
          topology: "vertex",
          key: vertex0,
          point: [0, 0, 0],
          lineage: [{ feature: "vertex-a", relation: "created" }],
          edges: [edge0],
        },
        {
          topology: "vertex",
          key: vertex1,
          point: [2, 0, 0],
          lineage: [{ feature: "vertex-b", relation: "modified" }],
          edges: [edge0],
        },
      ],
    },
  };
}

interface LineageRecordOffsets {
  readonly start: number;
  readonly end: number;
  readonly relation: number;
  readonly mask: number;
}

interface IndexArrayOffsets {
  readonly count: number;
  readonly values: readonly number[];
}

interface WireOffsets {
  readonly volume: number | undefined;
  readonly rootType: number;
  readonly rootOrientation: number;
  readonly orientations: readonly number[];
  readonly globalLineage: readonly LineageRecordOffsets[];
  readonly faceSurfaceMasks: readonly number[];
  readonly faceEdges: readonly IndexArrayOffsets[];
  readonly edgeCurveMasks: readonly number[];
  readonly edgeFaces: readonly IndexArrayOffsets[];
}

class TrustedWireCursor {
  offset = OCCT_ARTIFACT_SIDECAR_V2_HEADER_BYTES;
  readonly view: DataView;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  uint8(): number {
    const offset = this.offset;
    this.offset += 1;
    return offset;
  }

  uint32(): number {
    const value = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return value;
  }

  skip(bytes: number): void {
    this.offset += bytes;
  }

  skipString(): void {
    this.skip(this.uint32());
  }

  skipVector(): void {
    this.skip(24);
  }
}

function readLineageRecord(cursor: TrustedWireCursor): LineageRecordOffsets {
  const start = cursor.offset;
  const relation = cursor.uint8();
  const mask = cursor.uint8();
  cursor.skipString();
  if ((cursor.bytes[mask]! & 1) !== 0) cursor.skipString();
  if ((cursor.bytes[mask]! & 2) !== 0) {
    cursor.skipString();
    cursor.skipString();
  }
  return { start, end: cursor.offset, relation, mask };
}

function readLineageArray(
  cursor: TrustedWireCursor,
): readonly LineageRecordOffsets[] {
  const count = cursor.uint32();
  const records = new Array<LineageRecordOffsets>(count);
  for (let index = 0; index < count; index += 1) {
    records[index] = readLineageRecord(cursor);
  }
  return records;
}

function readIndexArray(cursor: TrustedWireCursor): IndexArrayOffsets {
  const countOffset = cursor.offset;
  const count = cursor.uint32();
  const values = new Array<number>(count);
  for (let index = 0; index < count; index += 1) {
    values[index] = cursor.offset;
    cursor.skip(4);
  }
  return { count: countOffset, values };
}

function skipDescriptor(
  cursor: TrustedWireCursor,
): number {
  const mask = cursor.uint8();
  cursor.skipString();
  const value = cursor.bytes[mask]!;
  if ((value & 1) !== 0) cursor.skipVector();
  if ((value & 2) !== 0) cursor.skipVector();
  if ((value & 4) !== 0) cursor.skip(8);
  return mask;
}

function locateWire(bytes: Uint8Array): WireOffsets {
  const cursor = new TrustedWireCursor(bytes);
  const header = cursor.view;
  const volume = header.getUint8(46) === 0 ? undefined : cursor.offset;
  if (volume !== undefined) cursor.skip(8);
  const rootType = cursor.uint8();
  const rootOrientation = cursor.uint8();
  cursor.uint32();
  cursor.uint32();
  cursor.uint32();
  const orientationCount = header.getUint32(40, false);
  const orientations = new Array<number>(orientationCount);
  for (let index = 0; index < orientationCount; index += 1) {
    orientations[index] = cursor.uint8();
  }
  const globalLineage = readLineageArray(cursor);
  const faceSurfaceMasks: number[] = [];
  const faceEdges: IndexArrayOffsets[] = [];
  for (let index = 0; index < header.getUint32(16, false); index += 1) {
    cursor.skip(80);
    faceSurfaceMasks.push(skipDescriptor(cursor));
    readLineageArray(cursor);
    faceEdges.push(readIndexArray(cursor));
  }
  const edgeCurveMasks: number[] = [];
  const edgeFaces: IndexArrayOffsets[] = [];
  for (let index = 0; index < header.getUint32(20, false); index += 1) {
    cursor.skip(80);
    edgeCurveMasks.push(skipDescriptor(cursor));
    readLineageArray(cursor);
    edgeFaces.push(readIndexArray(cursor));
    readIndexArray(cursor);
  }
  for (let index = 0; index < header.getUint32(24, false); index += 1) {
    cursor.skipVector();
    readLineageArray(cursor);
    readIndexArray(cursor);
  }
  expect(cursor.offset).toBe(bytes.byteLength);
  return {
    volume,
    rootType,
    rootOrientation,
    orientations,
    globalLineage,
    faceSurfaceMasks,
    faceEdges,
    edgeCurveMasks,
    edgeFaces,
  };
}

function changed(
  bytes: Uint8Array,
  mutate: (copy: Uint8Array, view: DataView) => void,
): Uint8Array {
  const copy = bytes.slice();
  mutate(
    copy,
    new DataView(copy.buffer, copy.byteOffset, copy.byteLength),
  );
  return copy;
}

function expectDecodeFailure(bytes: Uint8Array): void {
  expect(() => decodeOcctArtifactSidecarV2(bytes)).toThrow();
}

describe("OCCT binary artifact sidecar v2", () => {
  it("round-trips deterministic semantic state with canonical local topology", () => {
    const nonCanonical = richState(false);
    const canonical = richState(true);
    const encoded = encodeOcctArtifactSidecarV2(nonCanonical, {
      maxBytes: MAX_BYTES,
    });
    const canonicalBytes = encodeOcctArtifactSidecarV2(canonical, {
      maxBytes: MAX_BYTES,
    });

    expect(encoded).toEqual(canonicalBytes);
    expect([...encoded.subarray(0, 8)]).toEqual([
      0x49, 0x43, 0x41, 0x44, 0x53, 0x49, 0x44, 0x45,
    ]);
    const header = new DataView(
      encoded.buffer,
      encoded.byteOffset,
      OCCT_ARTIFACT_SIDECAR_V2_HEADER_BYTES,
    );
    expect(header.getUint16(8, false)).toBe(2);
    expect(header.getUint32(12, false)).toBe(encoded.byteLength);
    expect([
      header.getUint32(16, false),
      header.getUint32(20, false),
      header.getUint32(24, false),
    ]).toEqual([2, 2, 2]);
    expect(header.getUint32(28, false)).toBe(10);
    expect(header.getUint32(32, false)).toBe(9);
    expect(header.getUint32(36, false) % 2).toBe(0);
    expect(header.getUint32(36, false)).toBeGreaterThan(0);
    expect(header.getUint32(40, false)).toBe(9);
    expect([...encoded.subarray(44, 48)]).toEqual([2, 1, 1, 0]);

    const decoded = decodeOcctArtifactSidecarV2(encoded);
    expect(decoded.history).toBe("partial");
    expect(decoded.topology.history).toBe("complete");
    expect(decoded.volumeOverride).toBe(12.5);
    expect(decoded.lineage.map(({ feature }) => feature)).toEqual(["a", "b"]);
    expect(decoded.nativeStructure).toEqual(canonical.nativeStructure);
    expect(decoded.topology.faces[0]).toMatchObject({
      key: "artifact:face:0",
      area: 6,
      center: [1, 1.5, 0],
      surface: {
        kind: "plane",
        normal: [0, 0, 1],
        axis: [0, 1, 0],
        radius: 2,
      },
      edges: ["artifact:edge:0", "artifact:edge:1"],
    });
    expect(Object.is(decoded.topology.faces[0]!.center[2], -0)).toBe(false);
    expect(
      decoded.topology.faces[0]!.lineage.map(({ feature }) => feature),
    ).toEqual(["face-created", "face-modified"]);
    expect(decoded.topology.edges[0]).toMatchObject({
      key: "artifact:edge:0",
      faces: ["artifact:face:0", "artifact:face:1"],
      vertices: ["artifact:vertex:0", "artifact:vertex:1"],
      curve: {
        kind: "circle",
        direction: [1, 0, 0],
        axis: [0, 0, 1],
        radius: 1,
      },
    });
    expect(decoded.topology.vertices.map(({ key }) => key)).toEqual([
      "artifact:vertex:0",
      "artifact:vertex:1",
    ]);
    expect(
      encodeOcctArtifactSidecarV2(decoded, { maxBytes: MAX_BYTES }),
    ).toEqual(encoded);
  });

  it("keeps duplicate canonicalization independent from encoded string limits", () => {
    const record: KernelTopologyLineage = {
      feature: "x".repeat(50_000),
      relation: "created",
    };
    const single = encodeOcctArtifactSidecarV2(
      { ...richState(true), lineage: [record] },
      { maxBytes: MAX_BYTES },
    );
    const duplicate = encodeOcctArtifactSidecarV2(
      { ...richState(true), lineage: new Array(11).fill(record) },
      { maxBytes: MAX_BYTES },
    );
    expect(duplicate).toEqual(single);
  });

  it("preserves arbitrary UTF-16 code units including lone surrogates", () => {
    const feature = "feature-\ud800-tail";
    const state = {
      ...richState(true),
      lineage: [{ feature, relation: "created" as const }],
    };
    const encoded = encodeOcctArtifactSidecarV2(state, {
      maxBytes: MAX_BYTES,
    });
    const decoded = decodeOcctArtifactSidecarV2(encoded);

    expect(decoded.lineage[0]!.feature).toBe(feature);
    expect(decoded.lineage[0]!.feature.charCodeAt(8)).toBe(0xd800);
    expect(
      encodeOcctArtifactSidecarV2(decoded, { maxBytes: MAX_BYTES }),
    ).toEqual(encoded);
  });

  it("rejects roles outside the closed topology-role vocabulary", () => {
    const invalid = {
      ...richState(true),
      lineage: [
        {
          feature: "invalid-role",
          relation: "created" as const,
          role: "bad.face.x-min",
        },
      ],
    } as unknown as OcctShapeArtifactCapturedSidecarState;
    expect(() =>
      encodeOcctArtifactSidecarV2(invalid, { maxBytes: MAX_BYTES }),
    ).toThrow(/role/);

    const valid = {
      ...richState(true),
      lineage: [
        {
          feature: "valid-role",
          relation: "created" as const,
          role: "box.face.x-min" as const,
        },
      ],
    };
    const encoded = encodeOcctArtifactSidecarV2(valid, {
      maxBytes: MAX_BYTES,
    });
    const record = locateWire(encoded).globalLineage[0]!;
    const corrupted = changed(encoded, (copy, view) => {
      let offset = record.start + 2;
      const featureBytes = view.getUint32(offset, false);
      offset += 4 + featureBytes;
      const roleBytes = view.getUint32(offset, false);
      offset += 4;
      const replacement = "bad.face.x-min";
      expect(roleBytes).toBe(replacement.length * 2);
      for (let index = 0; index < replacement.length; index += 1) {
        view.setUint16(offset + index * 2, replacement.charCodeAt(index), false);
      }
      expect(copy.byteLength).toBe(encoded.byteLength);
    });
    expect(() => decodeOcctArtifactSidecarV2(corrupted)).toThrow(/role/);

    const invalidRoleSource = {
      ...richState(true),
      lineage: [
        {
          feature: "invalid-role-source",
          relation: "created" as const,
          role: "box.face.x-min" as const,
          source: {
            kind: "sketch-entity" as const,
            sketch: "profile",
            entity: "segment",
          },
        },
      ],
    };
    expect(() =>
      encodeOcctArtifactSidecarV2(invalidRoleSource, { maxBytes: MAX_BYTES }),
    ).toThrow(/role/);
  });

  it("normalizes signed zero on encode and rejects its non-canonical wire form", () => {
    const state = { ...richState(true), volumeOverride: -0 };
    const encoded = encodeOcctArtifactSidecarV2(state, {
      maxBytes: MAX_BYTES,
    });
    const offsets = locateWire(encoded);
    expect(offsets.volume).toBeDefined();
    const volume = offsets.volume!;
    const decoded = decodeOcctArtifactSidecarV2(encoded);
    expect(decoded.volumeOverride).toBe(0);
    expect(Object.is(decoded.volumeOverride, -0)).toBe(false);
    expect(
      new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength)
        .getFloat64(volume, false),
    ).toBe(0);

    expectDecodeFailure(
      changed(encoded, (_copy, view) => view.setFloat64(volume, -0, false)),
    );
    expectDecodeFailure(
      changed(encoded, (_copy, view) =>
        view.setFloat64(volume, Number.POSITIVE_INFINITY, false),
      ),
    );
  });

  it("honors pre-aborted signals and the caller's encode byte ceiling", () => {
    const state = richState(true);
    const encoded = encodeOcctArtifactSidecarV2(state, {
      maxBytes: MAX_BYTES,
    });
    expect(() =>
      encodeOcctArtifactSidecarV2(state, {
        maxBytes: encoded.byteLength - 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      encodeOcctArtifactSidecarV2(state, { maxBytes: 0 }),
    ).toThrow(RangeError);
    let stateReads = 0;
    const unreadable = Object.defineProperty({}, "history", {
      get: () => {
        stateReads += 1;
        throw new Error("state should not be read");
      },
    }) as OcctShapeArtifactCapturedSidecarState;
    expect(() =>
      encodeOcctArtifactSidecarV2(unreadable, { maxBytes: 65 }),
    ).toThrow(RangeError);
    expect(stateReads).toBe(0);

    const controller = new AbortController();
    controller.abort();
    for (const operation of [
      () =>
        encodeOcctArtifactSidecarV2(state, {
          maxBytes: MAX_BYTES,
          signal: controller.signal,
        }),
      () => decodeOcctArtifactSidecarV2(encoded, { signal: controller.signal }),
    ]) {
      expect(operation).toThrowError(
        expect.objectContaining({ name: "AbortError" }),
      );
    }
  });

  it("captures mutable option getters once", () => {
    const state = richState(true);
    let encodeSignalReads = 0;
    const encodeOptions = Object.defineProperty(
      { maxBytes: MAX_BYTES },
      "signal",
      {
        get: () => {
          encodeSignalReads += 1;
          return undefined;
        },
      },
    );
    const encoded = encodeOcctArtifactSidecarV2(state, encodeOptions);
    expect(encodeSignalReads).toBe(1);

    let decodeSignalReads = 0;
    const decodeOptions = Object.defineProperty({}, "signal", {
      get: () => {
        decodeSignalReads += 1;
        return undefined;
      },
    });
    expect(decodeOcctArtifactSidecarV2(encoded, decodeOptions)).toBeDefined();
    expect(decodeSignalReads).toBe(1);
  });

  it("captures array lengths once and enforces aggregate work budgets", () => {
    let lineageLengthReads = 0;
    const lineage = new Proxy(
      [{ feature: "proxy-lineage", relation: "created" as const }],
      {
        get: (target, property, receiver) => {
          if (property === "length") lineageLengthReads += 1;
          return Reflect.get(target, property, receiver) as unknown;
        },
      },
    );
    encodeOcctArtifactSidecarV2(
      { ...richState(true), lineage },
      { maxBytes: MAX_BYTES },
    );
    expect(lineageLengthReads).toBe(1);

    const excessiveLineage = new Array<KernelTopologyLineage>(1_000_000);
    expect(() =>
      encodeOcctArtifactSidecarV2(
        { ...richState(true), lineage: excessiveLineage },
        { maxBytes: MAX_BYTES },
      ),
    ).toThrow(/maxEvidenceRecords|preparation lineage/);

    const excessiveNative = {
      ...richState(true),
      nativeStructure: {
        ...richState(true).nativeStructure,
        solidOrientations: new Array(600_000),
        shellOrientations: new Array(600_000),
      },
    } as unknown as OcctShapeArtifactCapturedSidecarState;
    expect(() =>
      encodeOcctArtifactSidecarV2(excessiveNative, { maxBytes: MAX_BYTES }),
    ).toThrow(/native orientation/);
  });

  it("rejects corrupt magic, version, flags, reserved byte, and declared length", () => {
    const encoded = encodeOcctArtifactSidecarV2(richState(true), {
      maxBytes: MAX_BYTES,
    });
    const corruptions = [
      changed(encoded, (copy) => {
        copy[0] = copy[0]! ^ 0xff;
      }),
      changed(encoded, (_copy, view) => view.setUint16(8, 3, false)),
      changed(encoded, (_copy, view) => view.setUint16(10, 1, false)),
      changed(encoded, (copy) => {
        copy[47] = 1;
      }),
      changed(encoded, (_copy, view) =>
        view.setUint32(12, encoded.byteLength + 1, false),
      ),
    ];

    for (const corrupted of corruptions) expectDecodeFailure(corrupted);
  });

  it("preflights hostile table counts and cross-checks every aggregate counter", () => {
    const encoded = encodeOcctArtifactSidecarV2(richState(true), {
      maxBytes: MAX_BYTES,
    });
    expectDecodeFailure(
      changed(encoded, (_copy, view) => view.setUint32(16, 100_001, false)),
    );
    for (const [offset, decrement] of [
      [28, 1],
      [32, 1],
      [36, 2],
      [40, 1],
    ] as const) {
      expectDecodeFailure(
        changed(encoded, (_copy, view) =>
          view.setUint32(offset, view.getUint32(offset, false) - decrement, false),
        ),
      );
    }
  });

  it("rejects unknown header, native, orientation, and lineage enum tags", () => {
    const encoded = encodeOcctArtifactSidecarV2(richState(true), {
      maxBytes: MAX_BYTES,
    });
    const offsets = locateWire(encoded);
    const corruptions = [
      changed(encoded, (copy) => {
        copy[44] = 0;
      }),
      changed(encoded, (copy) => {
        copy[45] = 3;
      }),
      changed(encoded, (copy) => {
        copy[46] = 2;
      }),
      changed(encoded, (copy) => {
        copy[offsets.rootType] = 0;
      }),
      changed(encoded, (copy) => {
        copy[offsets.rootOrientation] = 5;
      }),
      changed(encoded, (copy) => {
        copy[offsets.orientations[0]!] = 0;
      }),
      changed(encoded, (copy) => {
        copy[offsets.globalLineage[0]!.relation] = 3;
      }),
    ];

    for (const corrupted of corruptions) expectDecodeFailure(corrupted);
  });

  it("rejects unknown lineage and geometry presence-mask bits", () => {
    const encoded = encodeOcctArtifactSidecarV2(richState(true), {
      maxBytes: MAX_BYTES,
    });
    const offsets = locateWire(encoded);
    const corruptions = [
      changed(encoded, (copy) => {
        const offset = offsets.globalLineage[0]!.mask;
        copy[offset] = copy[offset]! | 0x80;
      }),
      changed(encoded, (copy) => {
        const offset = offsets.faceSurfaceMasks[0]!;
        copy[offset] = copy[offset]! | 0x80;
      }),
      changed(encoded, (copy) => {
        const offset = offsets.edgeCurveMasks[0]!;
        copy[offset] = copy[offset]! | 0x80;
      }),
    ];

    for (const corrupted of corruptions) expectDecodeFailure(corrupted);
  });

  it("rejects duplicate, descending, and out-of-range topology indices", () => {
    const encoded = encodeOcctArtifactSidecarV2(richState(true), {
      maxBytes: MAX_BYTES,
    });
    const offsets = locateWire(encoded);
    const faceEdges = offsets.faceEdges[0]!;
    expect(faceEdges.values).toHaveLength(2);
    const [first, second] = faceEdges.values;
    const corruptions = [
      changed(encoded, (_copy, view) => {
        view.setUint32(first!, 0, false);
        view.setUint32(second!, 0, false);
      }),
      changed(encoded, (_copy, view) => {
        view.setUint32(first!, 1, false);
        view.setUint32(second!, 0, false);
      }),
      changed(encoded, (_copy, view) => view.setUint32(first!, 2, false)),
    ];

    for (const corrupted of corruptions) expectDecodeFailure(corrupted);
  });

  it("rejects duplicate and reordered canonical lineage records", () => {
    const encoded = encodeOcctArtifactSidecarV2(richState(true), {
      maxBytes: MAX_BYTES,
    });
    const offsets = locateWire(encoded);
    const [first, second] = offsets.globalLineage;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first!.end - first!.start).toBe(second!.end - second!.start);

    const duplicate = changed(encoded, (copy) => {
      copy.set(copy.slice(first!.start, first!.end), second!.start);
    });
    const reordered = changed(encoded, (copy) => {
      const firstRecord = copy.slice(first!.start, first!.end);
      const secondRecord = copy.slice(second!.start, second!.end);
      copy.set(secondRecord, first!.start);
      copy.set(firstRecord, second!.start);
    });
    expectDecodeFailure(duplicate);
    expectDecodeFailure(reordered);
  });

  it("rejects truncation and adjusted-length trailing data", () => {
    const encoded = encodeOcctArtifactSidecarV2(richState(true), {
      maxBytes: MAX_BYTES,
    });
    expectDecodeFailure(encoded.slice(0, -1));

    const trailing = new Uint8Array(encoded.byteLength + 1);
    trailing.set(encoded);
    new DataView(trailing.buffer).setUint32(12, trailing.byteLength, false);
    expectDecodeFailure(trailing);
  });

  it("validates reciprocal topology after canonical binary parsing", () => {
    const encoded = encodeOcctArtifactSidecarV2(richState(true), {
      maxBytes: MAX_BYTES,
    });
    const offsets = locateWire(encoded);
    const secondFaceEdge = offsets.faceEdges[1]!.values[0]!;
    const corrupted = changed(encoded, (_copy, view) => {
      // Face 1 originally references edge 0. Edge 1 is in range and the
      // singleton array remains canonical, but edge 1 only references face 0.
      view.setUint32(secondFaceEdge, 1, false);
    });

    expect(() => decodeOcctArtifactSidecarV2(corrupted)).toThrow(
      /face-to-edge adjacency/,
    );
  });
});
