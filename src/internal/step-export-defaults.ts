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
 * Every UTF-16 code unit encodes to at least one UTF-8 byte, so text beyond
 * the budget can never be emitted; the helpers never scan or copy it.
 * A package-private marker also tells a bundled kernel that an export context
 * came from a plain, option-free `export("step")` call.
 */

const stepDefaultsReflectApply = Reflect.apply;
const stepDefaultsStringCharCodeAt = String.prototype.charCodeAt;
const stepDefaultsStringSlice = String.prototype.slice;
const stepDefaultsWeakSetAdd = WeakSet.prototype.add;
const stepDefaultsWeakSetHas = WeakSet.prototype.has;
const automaticStepExportContexts = new WeakSet<object>();

/** Placeholder for a required automatic field whose authored text is empty. */
export const AUTOMATIC_STEP_TEXT_FALLBACK = "InvariantCAD Shape";

/**
 * Marks an export context that the evaluator built for a plain
 * `export("step")` call with no options. A kernel in this package that can
 * write the shape only as several STEP products returns its weak native bytes
 * for a marked context instead of refusing, so the plain export runs the
 * native writer once. Code outside the package cannot mark a context.
 */
export function markAutomaticStepExportContext<T extends object>(
  context: T,
): T {
  stepDefaultsReflectApply(
    stepDefaultsWeakSetAdd,
    automaticStepExportContexts,
    [context],
  );
  return context;
}

/** Whether {@link markAutomaticStepExportContext} marked this context. */
export function isAutomaticStepExportContext(context: unknown): boolean {
  return (
    typeof context === "object" &&
    context !== null &&
    (stepDefaultsReflectApply(
      stepDefaultsWeakSetHas,
      automaticStepExportContexts,
      [context],
    ) as boolean)
  );
}

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
  return stepTextUtf8LengthUpTo(value, Number.POSITIVE_INFINITY);
}

/**
 * UTF-8 size of `value`, scanning only until the size exceeds `limit`.
 * Returns the exact size when it is at most `limit`, and otherwise some size
 * greater than `limit`, so an oversized value costs at most `limit + 1` code
 * units of work.
 */
export function stepTextUtf8LengthUpTo(value: string, limit: number): number {
  let bytes = 0;
  for (
    let index = 0;
    index < value.length && bytes <= limit;
    index += 1
  ) {
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
 * Normalizes an automatic default that must fit `maximumBytes` UTF-8 bytes.
 *
 * Only the first `maximumBytes + 1` code units are read (one more when the
 * cut would split a surrogate pair). A prefix that long already exceeds the
 * budget, so fitting truncates it and strict validation rejects it at the
 * same position as the full text, while long authored text is never copied.
 */
export function boundedAutomaticStepText(
  value: string,
  maximumBytes: number,
): string {
  const limit = (maximumBytes > 0 ? maximumBytes : 0) + 1;
  let end = value.length;
  if (end > limit) {
    end = limit;
    if (
      isHighSurrogate(codeUnitAt(value, end - 1)) &&
      isLowSurrogate(codeUnitAt(value, end))
    ) {
      end += 1;
    }
  }
  return normalizeAutomaticStepText(
    end === value.length ? value : slice(value, 0, end),
  );
}

/** UTF-8 size of the first Unicode scalar, or 0 for an empty string. */
function firstScalarUtf8Length(value: string): number {
  if (value.length === 0) return 0;
  const code = codeUnitAt(value, 0);
  if (
    isHighSurrogate(code) &&
    value.length > 1 &&
    isLowSurrogate(codeUnitAt(value, 1))
  ) {
    return 4;
  }
  return code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3;
}

/**
 * Fits normalized automatic values into `budget` UTF-8 bytes in total.
 *
 * Values that already fit are returned unchanged. Otherwise each `required`
 * value first keeps its first Unicode scalar, so a short budget never
 * empties a required field that could still fit. The rest of the budget is
 * shared fairly: values with less remaining text keep it all and the leftover
 * bytes are split evenly among the longer values, each truncated at a
 * Unicode scalar boundary. Values longer than the whole remaining budget are
 * all truncated and are ordered by position, so text past the budget is never
 * scanned and cannot change the result. When the reserved scalars alone
 * exceed the budget the result still exceeds it, so strict validation reports
 * the overflow. The result depends only on the values, the flags, and the
 * budget.
 */
export function fitAutomaticStepTexts(
  values: readonly string[],
  budget: number,
  required: readonly boolean[] = [],
): string[] {
  const count = values.length;
  const nonnegativeBudget = budget < 0 ? 0 : budget;
  // A scalar is at most four bytes, so a measured size past this cap proves
  // that the value exceeds the budget even after its reserved scalar.
  const measureLimit = nonnegativeBudget + 4;
  const lengths: number[] = [];
  const reserved: number[] = [];
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    const value = values[index]!;
    const length = stepTextUtf8LengthUpTo(value, measureLimit);
    lengths[index] = length;
    reserved[index] =
      required[index] === true ? firstScalarUtf8Length(value) : 0;
    total += length;
  }
  const result: string[] = [];
  for (let index = 0; index < count; index += 1) result[index] = values[index]!;
  if (total <= budget) return result;

  let remaining = nonnegativeBudget;
  for (let index = 0; index < count; index += 1) remaining -= reserved[index]!;
  if (remaining < 0) remaining = 0;

  // Insertion sort by unreserved size, then index: tiny, and independent of
  // Array.prototype.sort. Sizes past the remaining budget compare equal.
  const sortKey = (index: number): number => {
    const excess = lengths[index]! - reserved[index]!;
    return excess > remaining ? remaining + 1 : excess;
  };
  const order: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const key = sortKey(index);
    let position = index;
    while (position > 0) {
      const previous = order[position - 1]!;
      if (sortKey(previous) <= key) break;
      order[position] = previous;
      position -= 1;
    }
    order[position] = index;
  }
  for (let rank = 0; rank < count; rank += 1) {
    const index = order[rank]!;
    const share = Math.floor(remaining / (count - rank));
    // An untruncated value was measured exactly: it fits within its share.
    let used = lengths[index]!;
    if (used - reserved[index]! > share) {
      result[index] = truncateUtf8(values[index]!, reserved[index]! + share);
      used = stepTextUtf8Length(result[index]!);
    }
    remaining -= used - reserved[index]!;
  }
  return result;
}

/**
 * Resolves STEP text fields where each field is either explicit caller text
 * (kept verbatim for strict validation) or an automatic default (normalized,
 * replaced by {@link AUTOMATIC_STEP_TEXT_FALLBACK} when required and empty,
 * and fitted into the budget left after the explicit fields).
 *
 * `budget` is the room for these fields and `maximumBytes` the whole metadata
 * ceiling that strict validation enforces afterwards. Explicit text is
 * measured only until it exceeds the remaining budget, and automatic text is
 * read only up to `maximumBytes` (see {@link boundedAutomaticStepText}).
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
  maximumBytes: number = budget,
): string[] {
  const count = automatic.length;
  let remaining = budget;
  const automaticIndices: number[] = [];
  const automaticValues: string[] = [];
  const automaticRequired: boolean[] = [];
  let reserved = 0;
  const result: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const explicitValue = explicit[index];
    if (explicitValue !== undefined) {
      result[index] = explicitValue;
      remaining -= stepTextUtf8LengthUpTo(
        explicitValue,
        remaining > 0 ? remaining : 0,
      );
      continue;
    }
    let value = boundedAutomaticStepText(automatic[index]!, maximumBytes);
    if (required[index] === true && value.length === 0) {
      value = AUTOMATIC_STEP_TEXT_FALLBACK;
    }
    result[index] = value;
    if (required[index] === true) reserved += firstScalarUtf8Length(value);
    automaticIndices[automaticIndices.length] = index;
    automaticValues[automaticValues.length] = value;
    automaticRequired[automaticRequired.length] = required[index] === true;
  }
  if (automaticIndices.length === 0 || reserved > remaining) return result;
  const fitted = fitAutomaticStepTexts(
    automaticValues,
    remaining,
    automaticRequired,
  );
  for (let rank = 0; rank < automaticIndices.length; rank += 1) {
    result[automaticIndices[rank]!] = fitted[rank]!;
  }
  return result;
}
