const IntrinsicArray = Array;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const intrinsicStringCharCodeAt = String.prototype.charCodeAt;
const reflectApply = Reflect.apply;
const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Counts one string's TextEncoder-equivalent UTF-8 bytes without constructing
 * an encoded buffer. Returns undefined as soon as the ceiling is exceeded.
 */
export function utf8ByteLengthWithin(
  value: string,
  maximumBytes: number,
): number | undefined {
  const applyArguments = new IntrinsicArray<unknown>(1);
  applyArguments[0] = maximumBytes;
  if (
    !reflectApply(intrinsicNumberIsSafeInteger, Number, applyArguments) ||
    maximumBytes < 0
  ) {
    throw new TypeError(
      "maximumBytes must be a nonnegative safe integer",
    );
  }
  if (value.length > maximumBytes) return undefined;

  let byteLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    applyArguments[0] = index;
    const codeUnit = reflectApply(
      intrinsicStringCharCodeAt,
      value,
      applyArguments,
    ) as number;
    let width: number;
    if (codeUnit <= 0x7f) {
      width = 1;
    } else if (codeUnit <= 0x7ff) {
      width = 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      let trailing = -1;
      if (index + 1 < value.length) {
        applyArguments[0] = index + 1;
        trailing = reflectApply(
          intrinsicStringCharCodeAt,
          value,
          applyArguments,
        ) as number;
      }
      if (trailing >= 0xdc00 && trailing <= 0xdfff) {
        width = 4;
        index += 1;
      } else {
        width = 3;
      }
    } else {
      width = 3;
    }
    if (width > maximumBytes - byteLength) return undefined;
    byteLength += width;
  }
  return byteLength;
}

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
