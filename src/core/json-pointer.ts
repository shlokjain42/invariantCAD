/**
 * Escapes one JSON Pointer reference token (RFC 6901): `~` becomes `~0` and
 * `/` becomes `~1`, so authored IDs that contain either character still point
 * at the right member.
 */
export function jsonPointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
