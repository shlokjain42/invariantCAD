const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Checks one nonempty, canonically round-trippable UTF-8 string without an
 * unbounded intermediate allocation. A string longer than the byte ceiling in
 * UTF-16 code units cannot fit even when every code unit is ASCII.
 */
export function isCanonicalUtf8StringWithin(
  value: unknown,
  maximumBytes: number,
): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumBytes
  ) {
    return false;
  }
  try {
    const bytes = textEncoder.encode(value);
    return (
      bytes.byteLength <= maximumBytes &&
      fatalTextDecoder.decode(bytes) === value
    );
  } catch {
    return false;
  }
}
