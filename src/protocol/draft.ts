import type { Vec3 } from "../core/math.js";

/**
 * Smallest absolute draft angle accepted by the owned OCCT facade.
 *
 * The pinned kernel silently treats smaller angles as a no-op. Protocol
 * resolution must reject `Math.abs(angle) <= DRAFT_MIN_ANGLE_RADIANS` before
 * invoking a draft-capable kernel.
 */
export const DRAFT_MIN_ANGLE_RADIANS = 1e-4 as const;

/** Kernel-neutral, fully evaluated options for an atomic multi-face draft. */
export interface ResolvedDraftNeutralPlane {
  /** Point on the neutral plane in document length units. */
  readonly origin: Vec3;
  /** Nonzero plane normal passed to the kernel without changing its scale. */
  readonly normal: Vec3;
}

export interface ResolvedDraftOptions {
  /** Signed radians satisfying `1e-4 < Math.abs(angle) < Math.PI / 2`. */
  readonly angle: number;
  /** Nonzero direction along which the drafted faces are pulled. */
  readonly pullDirection: Vec3;
  /** Arbitrary neutral plane kept fixed by the draft operation. */
  readonly neutralPlane: ResolvedDraftNeutralPlane;
}
