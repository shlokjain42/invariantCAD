/**
 * Total mapping from authored text to automatic STEP metadata defaults.
 *
 * Explicit caller metadata is validated strictly and rejected when it is not
 * STEP-representable. Automatic defaults come from authored document data
 * (document names, output aliases, part numbers and descriptions) that the
 * document schema does not restrict, so they must never make a plain export
 * fail. These helpers replace control characters with spaces, replace
 * unpaired UTF-16 surrogates with U+FFFD, and truncate the longest values at
 * Unicode scalar boundaries until the combined UTF-8 size fits a budget.
 */

const stepDefaultsReflectApply = Reflect.apply;
const stepDefaultsStringCharCodeAt = String.prototype.charCodeAt;
const stepDefaultsStringSlice = String.prototype.slice;

/** Placeholder for a required automatic field whose authored text is empty. */
export const AUTOMATIC_STEP_TEXT_FALLBACK = "InvariantCAD Shape";

function codeUnitAt(value: string, index: number): number {
  return stepDefaultsReflectApply(
    stepDefaultsStringCharCodeAt,
    value,
    [index],
  ) as number;
}

function slice(value: string, start: number, end: number): string {
  return stepDefaultsReflectApply(stepDefaultsStringSlice, value, [
    start,
    end,
  ]) as string;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Replaces C0/C1 control characters and DEL with U+0020 and unpaired
 * surrogates with U+FFFD. Every other code unit is preserved, so the result is
 * never shorter than the input in code units.
 */
export function normalizeAutomaticStepText(value: string): string {
  let result = "";
  let runStart = 0;
  const length = value.length;
  for (let index = 0; index < length; index += 1) {
    const code = codeUnitAt(value, index);
    let replacement: string | undefined;
    if (isHighSurrogate(code)) {
      if (index + 1 < length && isLowSurrogate(codeUnitAt(value, index + 1))) {
        index += 1;
        continue;
      }
      replacement = "\uFFFD";
    } else if (isLowSurrogate(code)) {
      replacement = "\uFFFD";
    } else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      replacement = " ";
    }
    if (replacement !== undefined) {
      result += slice(value, runStart, index) + replacement;
      runStart = index + 1;
    }
  }
  return runStart === 0 ? value : result + slice(value, runStart, length);
}

/** UTF-8 size; an unpaired surrogate counts as its three-byte encoding. */
export function stepTextUtf8Length(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = codeUnitAt(value, index);
    if (
      isHighSurrogate(code) &&
      index + 1 < value.length &&
      isLowSurrogate(codeUnitAt(value, index + 1))
    ) {
      bytes += 4;
      index += 1;
    } else if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** Longest scalar-boundary prefix whose UTF-8 size is at most `maximum`. */
function truncateUtf8(value: string, maximum: number): string {
  let bytes = 0;
  let index = 0;
  while (index < value.length) {
    const code = codeUnitAt(value, index);
    const width = isHighSurrogate(code)
      ? 4
      : code <= 0x7f
        ? 1
        : code <= 0x7ff
          ? 2
          : 3;
    if (bytes + width > maximum) break;
    bytes += width;
    index += isHighSurrogate(code) ? 2 : 1;
  }
  return slice(value, 0, index);
}

/**
 * Fits normalized automatic values into `budget` UTF-8 bytes in total.
 *
 * Values that already fit are returned unchanged. Otherwise the budget is
 * shared fairly: shorter values keep their full text and the remaining bytes
 * are split evenly among the longer values, each truncated at a Unicode scalar
 * boundary. The result depends only on the values and the budget.
 */
export function fitAutomaticStepTexts(
  values: readonly string[],
  budget: number,
): string[] {
  const count = values.length;
  const lengths: number[] = [];
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    const length = stepTextUtf8Length(values[index]!);
    lengths[index] = length;
    total += length;
  }
  const result: string[] = [];
  for (let index = 0; index < count; index += 1) result[index] = values[index]!;
  if (total <= budget) return result;

  // Insertion sort by size, then index: tiny, and independent of
  // Array.prototype.sort.
  const order: number[] = [];
  for (let index = 0; index < count; index += 1) {
    let position = index;
    while (position > 0 && lengths[order[position - 1]!]! > lengths[index]!) {
      order[position] = order[position - 1]!;
      position -= 1;
    }
    order[position] = index;
  }
  let remaining = budget < 0 ? 0 : budget;
  for (let rank = 0; rank < count; rank += 1) {
    const index = order[rank]!;
    const share = Math.floor(remaining / (count - rank));
    if (lengths[index]! > share) {
      result[index] = truncateUtf8(values[index]!, share);
    }
    remaining -= stepTextUtf8Length(result[index]!);
  }
  return result;
}

/**
 * Resolves STEP text fields where each field is either explicit caller text
 * (kept verbatim for strict validation) or an automatic default (normalized,
 * replaced by {@link AUTOMATIC_STEP_TEXT_FALLBACK} when required and empty,
 * and fitted into the budget left after the explicit fields).
 *
 * When the explicit fields leave too little room for every required automatic
 * field to keep at least one scalar, the automatic values are returned
 * untruncated so strict validation reports the caller's budget overflow.
 */
export function resolveAutomaticStepTexts(
  explicit: readonly (string | undefined)[],
  automatic: readonly string[],
  required: readonly boolean[],
  budget: number,
): string[] {
  const count = automatic.length;
  let remaining = budget;
  const automaticIndices: number[] = [];
  const automaticValues: string[] = [];
  const result: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const explicitValue = explicit[index];
    if (explicitValue !== undefined) {
      result[index] = explicitValue;
      remaining -= stepTextUtf8Length(explicitValue);
      continue;
    }
    let value = normalizeAutomaticStepText(automatic[index]!);
    if (required[index] === true && value.length === 0) {
      value = AUTOMATIC_STEP_TEXT_FALLBACK;
    }
    result[index] = value;
    automaticIndices[automaticIndices.length] = index;
    automaticValues[automaticValues.length] = value;
  }
  if (automaticIndices.length === 0 || remaining < 0) return result;
  const fitted = fitAutomaticStepTexts(automaticValues, remaining);
  for (let rank = 0; rank < automaticIndices.length; rank += 1) {
    const index = automaticIndices[rank]!;
    if (required[index] === true && fitted[rank]!.length === 0) return result;
  }
  for (let rank = 0; rank < automaticIndices.length; rank += 1) {
    result[automaticIndices[rank]!] = fitted[rank]!;
  }
  return result;
}
