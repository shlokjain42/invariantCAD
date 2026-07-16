import { describe, expect, it, vi } from "vitest";
import {
  adoptOcctEdgeEvolution,
  type OcctEmbindVector,
  type OcctRawEvolutionData,
} from "../src/internal/occt-evolution.js";

class FakeVector implements OcctEmbindVector {
  readonly values: number[] = [];
  readonly delete = vi.fn();

  constructor(values: readonly number[] = []) {
    this.values.push(...values);
  }

  push_back(value: number): void {
    this.values.push(value);
  }

  get(index: number): number {
    return this.values[index]!;
  }

  size(): number {
    return this.values.length;
  }
}

function fixture() {
  const inputVectors: FakeVector[] = [];
  const module = {
    VectorUint32: class extends FakeVector {
      constructor() {
        super();
        inputVectors.push(this);
      }
    },
    VectorInt: class extends FakeVector {
      constructor() {
        super();
        inputVectors.push(this);
      }
    },
  };
  const kernel = { release: vi.fn() };
  return { inputVectors, kernel, module };
}

function rawEvolution(resultId = 91): OcctRawEvolutionData & {
  delete: ReturnType<typeof vi.fn>;
  readonly outputVectors: readonly FakeVector[];
} {
  const modified = new FakeVector([11, 12]);
  const generated = new FakeVector([21]);
  const deleted = new FakeVector([31, 32]);
  return {
    resultId,
    modified,
    generated,
    deleted,
    delete: vi.fn(),
    outputVectors: [modified, generated, deleted],
  };
}

describe("raw OCCT evolution ownership", () => {
  it("copies history and transfers the result after successful adoption", () => {
    const { inputVectors, kernel, module } = fixture();
    const raw = rawEvolution();
    const invoke = vi.fn(
      (edges: OcctEmbindVector, hashes: OcctEmbindVector) => {
        expect((edges as FakeVector).values).toEqual([4, 8]);
        expect((hashes as FakeVector).values).toEqual([101, 202]);
        return raw;
      },
    );
    const adopt = vi.fn((evolution) => {
      for (const vector of [...inputVectors, ...raw.outputVectors]) {
        expect(vector.delete).toHaveBeenCalledTimes(1);
      }
      expect(raw.delete).toHaveBeenCalledTimes(1);
      return { handle: evolution.resultId };
    });

    expect(
      adoptOcctEdgeEvolution({
        module,
        kernel,
        edgeIds: [4, 8],
        inputFaceHashes: [101, 202],
        invoke,
        adopt,
      }),
    ).toEqual({ handle: 91 });

    expect(adopt).toHaveBeenCalledWith({
      resultId: 91,
      modified: [11, 12],
      generated: [21],
      deleted: [31, 32],
    });
    expect(inputVectors).toHaveLength(2);
    for (const vector of inputVectors) {
      expect(vector.delete).toHaveBeenCalledTimes(1);
    }
    for (const vector of raw.outputVectors) {
      expect(vector.delete).toHaveBeenCalledTimes(1);
    }
    expect(raw.delete).toHaveBeenCalledTimes(1);
    expect(kernel.release).not.toHaveBeenCalled();
  });

  it("cleans input vectors when the raw history callback fails", () => {
    const { inputVectors, kernel, module } = fixture();
    const failure = new Error("fillet failed");

    expect(() =>
      adoptOcctEdgeEvolution({
        module,
        kernel,
        edgeIds: [7],
        inputFaceHashes: [303],
        invoke: () => {
          throw failure;
        },
        adopt: () => {
          throw new Error("unreachable");
        },
      }),
    ).toThrow(failure);

    expect(inputVectors).toHaveLength(2);
    for (const vector of inputVectors) {
      expect(vector.delete).toHaveBeenCalledTimes(1);
    }
    expect(kernel.release).not.toHaveBeenCalled();
  });

  it("deletes a partially populated input vector when construction fails", () => {
    const created: FakeVector[] = [];
    const failed = new Error("vector allocation failed");
    const module = {
      VectorUint32: class extends FakeVector {
        constructor() {
          super();
          created.push(this);
        }

        override push_back(value: number): void {
          super.push_back(value);
          throw failed;
        }
      },
      VectorInt: FakeVector,
    };
    const kernel = { release: vi.fn() };
    const invoke = vi.fn();

    expect(() =>
      adoptOcctEdgeEvolution({
        module,
        kernel,
        edgeIds: [7],
        inputFaceHashes: [],
        invoke,
        adopt: () => "unreachable",
      }),
    ).toThrow(failed);

    expect(created).toHaveLength(1);
    expect(created[0]!.delete).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
    expect(kernel.release).not.toHaveBeenCalled();
  });

  it("deletes all evolution data and releases a result rejected by adoption", () => {
    const { inputVectors, kernel, module } = fixture();
    const raw = rawEvolution(73);
    const failure = new Error("kernel disposed before adoption");

    expect(() =>
      adoptOcctEdgeEvolution({
        module,
        kernel,
        edgeIds: [5],
        inputFaceHashes: [404],
        invoke: () => raw,
        adopt: () => {
          throw failure;
        },
      }),
    ).toThrow(failure);

    for (const vector of [...inputVectors, ...raw.outputVectors]) {
      expect(vector.delete).toHaveBeenCalledTimes(1);
    }
    expect(raw.delete).toHaveBeenCalledTimes(1);
    expect(kernel.release).toHaveBeenCalledTimes(1);
    expect(kernel.release).toHaveBeenCalledWith(73);
  });

  it("does not release an adopted handle and rejects a zero sentinel", () => {
    const successful = fixture();
    const successRaw = rawEvolution(44);
    adoptOcctEdgeEvolution({
      module: successful.module,
      kernel: successful.kernel,
      edgeIds: [],
      inputFaceHashes: [],
      invoke: () => successRaw,
      adopt: () => "owned",
    });
    expect(successful.kernel.release).not.toHaveBeenCalled();

    const failedSentinel = fixture();
    const sentinelRaw = rawEvolution(0);
    expect(() =>
      adoptOcctEdgeEvolution({
        module: failedSentinel.module,
        kernel: failedSentinel.kernel,
        edgeIds: [],
        inputFaceHashes: [],
        invoke: () => sentinelRaw,
        adopt: () => "unreachable",
      }),
    ).toThrow("invalid result handle '0'");
    expect(failedSentinel.kernel.release).not.toHaveBeenCalled();
  });

  it("rejects an undeletable evolution container and releases its result", () => {
    const { inputVectors, kernel, module } = fixture();
    const raw = rawEvolution(62);
    const { delete: _delete, outputVectors: _outputVectors, ...undeletable } = raw;

    expect(() =>
      adoptOcctEdgeEvolution({
        module,
        kernel,
        edgeIds: [9],
        inputFaceHashes: [505],
        invoke: () => undeletable,
        adopt: () => "unreachable",
      }),
    ).toThrow("not a deletable Embind object");

    for (const vector of [...inputVectors, ...raw.outputVectors]) {
      expect(vector.delete).toHaveBeenCalledTimes(1);
    }
    expect(kernel.release).toHaveBeenCalledExactlyOnceWith(62);
  });
});
