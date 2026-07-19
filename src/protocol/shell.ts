export const SHELL_DIRECTIONS = Object.freeze(["inward", "outward"] as const);

export type ShellDirection = (typeof SHELL_DIRECTIONS)[number];

export interface ResolvedShellOptions {
  /** Positive nominal normal-offset distance in document length units. */
  readonly thickness: number;
  readonly direction: ShellDirection;
  /** Absolute reconstruction tolerance in document length units. */
  readonly tolerance: number;
}

/**
 * Current document shells use round/arc joins at offset-face transitions.
 * Intersection/miter and other join modes require a future serialized contract.
 */
export const SHELL_JOIN_SEMANTICS = "round" as const;
