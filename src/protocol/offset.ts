export const OFFSET_DIRECTIONS = Object.freeze(["inward", "outward"] as const);

export type OffsetDirection = (typeof OFFSET_DIRECTIONS)[number];

export interface ResolvedOffsetOptions {
  /** Positive normal-offset magnitude in document length units. */
  readonly distance: number;
  readonly direction: OffsetDirection;
  /** Absolute reconstruction tolerance in document length units. */
  readonly tolerance: number;
}

/** Current document solid offsets use round/arc joins at face transitions. */
export const OFFSET_JOIN_SEMANTICS = "round" as const;
