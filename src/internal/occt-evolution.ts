/**
 * Minimal structural types for the Embind objects used by OCCT history calls.
 *
 * `occt-wasm@3.7.0` omits `delete()` from its `RawEvolutionData` declaration,
 * even though the object is an Embind class instance at runtime. Keeping this
 * boundary structural lets callers use the vendor types while this helper owns
 * every temporary deterministically.
 */
export interface OcctEmbindVector {
  push_back(value: number): void;
  get(index: number): number;
  size(): number;
  delete(): void;
}

export interface OcctEvolutionModule {
  readonly VectorUint32: new () => OcctEmbindVector;
  readonly VectorInt: new () => OcctEmbindVector;
}

export interface OcctEvolutionKernel {
  release(resultId: number): void;
}

export interface OcctRawEvolutionData {
  readonly resultId: number;
  readonly modified: OcctEmbindVector;
  readonly generated: OcctEmbindVector;
  readonly deleted: OcctEmbindVector;
}

export interface OcctEvolutionSnapshot {
  readonly resultId: number;
  readonly modified: readonly number[];
  readonly generated: readonly number[];
  readonly deleted: readonly number[];
}

export interface AdoptOcctEdgeEvolutionOptions<T> {
  readonly module: OcctEvolutionModule;
  readonly kernel: OcctEvolutionKernel;
  readonly edgeIds: readonly number[];
  readonly inputFaceHashes: readonly number[];
  readonly invoke: (
    edgeIds: OcctEmbindVector,
    inputFaceHashes: OcctEmbindVector,
  ) => OcctRawEvolutionData;
  /**
   * Takes ownership of `evolution.resultId` only by returning successfully.
   * If this callback throws, the helper releases the result handle.
   */
  readonly adopt: (evolution: OcctEvolutionSnapshot) => T;
}

interface DeletableEmbindObject {
  delete(): void;
}

function makeVector(
  Vector: new () => OcctEmbindVector,
  values: readonly number[],
): OcctEmbindVector {
  const vector = new Vector();
  try {
    for (const value of values) vector.push_back(value);
    return vector;
  } catch (error) {
    vector.delete();
    throw error;
  }
}

function drainVector(vector: OcctEmbindVector): readonly number[] {
  try {
    const values: number[] = [];
    const size = vector.size();
    for (let index = 0; index < size; index += 1) {
      values.push(vector.get(index));
    }
    return values;
  } finally {
    vector.delete();
  }
}

function deleteEvolutionData(evolution: OcctRawEvolutionData): void {
  const candidate = evolution as OcctRawEvolutionData &
    Partial<DeletableEmbindObject>;
  if (typeof candidate.delete !== "function") {
    throw new TypeError("OCCT EvolutionData is not a deletable Embind object");
  }
  candidate.delete();
}

function isReleasableResultId(resultId: number): boolean {
  return Number.isSafeInteger(resultId) && resultId > 0;
}

/**
 * Runs a raw fillet/chamfer-style OCCT history operation and transfers its
 * result handle to `adopt` without leaking any Embind-owned temporaries.
 */
export function adoptOcctEdgeEvolution<T>(
  options: AdoptOcctEdgeEvolutionOptions<T>,
): T {
  let resultToRelease: number | undefined;
  let adopted = false;
  try {
    let evolution: OcctEvolutionSnapshot;
    const edgeIds = makeVector(options.module.VectorUint32, options.edgeIds);
    try {
      const inputFaceHashes = makeVector(
        options.module.VectorInt,
        options.inputFaceHashes,
      );
      try {
        const rawEvolution = options.invoke(edgeIds, inputFaceHashes);
        try {
          const resultId = rawEvolution.resultId;
          if (!isReleasableResultId(resultId)) {
            throw new TypeError(
              `OCCT history operation returned invalid result handle '${resultId}'`,
            );
          }
          resultToRelease = resultId;
          evolution = {
            resultId,
            modified: drainVector(rawEvolution.modified),
            generated: drainVector(rawEvolution.generated),
            deleted: drainVector(rawEvolution.deleted),
          };
        } finally {
          deleteEvolutionData(rawEvolution);
        }
      } finally {
        inputFaceHashes.delete();
      }
    } finally {
      edgeIds.delete();
    }

    const result = options.adopt(evolution);
    adopted = true;
    return result;
  } finally {
    if (!adopted && resultToRelease !== undefined) {
      options.kernel.release(resultToRelease);
    }
  }
}
