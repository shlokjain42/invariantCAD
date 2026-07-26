import { DEFAULT_KERNEL_STEP_EXPORT_TIMESTAMP } from "../kernel.js";

export const OCCT_STEP_METADATA_TIMESTAMP =
  DEFAULT_KERNEL_STEP_EXPORT_TIMESTAMP;

export interface OcctStepMetadata {
  readonly fileName: string;
  readonly timestamp: string;
  readonly productId: string;
  readonly productName: string;
  readonly productDescription: string;
}

export interface OcctStepMetadataLimits {
  readonly maxInputCodeUnits?: number;
  readonly maxOutputUtf8Bytes?: number;
  readonly maxScanUnits?: number;
  readonly maxEntityCount?: number;
  readonly maxMetadataUtf8Bytes?: number;
}

export interface RewriteOcctStepMetadataOptions {
  readonly metadata: OcctStepMetadata;
  readonly signal?: AbortSignal;
  readonly limits?: OcctStepMetadataLimits;
}

interface PreparedOcctStepMetadataRewrite {
  readonly metadata: EncodedMetadata;
  readonly signal: AbortSignal | undefined;
  readonly limits: ResolvedLimits;
}

interface ResolvedLimits {
  readonly maxInputCodeUnits: number;
  readonly maxOutputUtf8Bytes: number;
  readonly maxScanUnits: number;
  readonly maxEntityCount: number;
  readonly maxMetadataUtf8Bytes: number;
}

export const DEFAULT_OCCT_STEP_METADATA_LIMITS: Readonly<ResolvedLimits> =
  Object.freeze({
    maxInputCodeUnits: 64 * 1024 * 1024,
    maxOutputUtf8Bytes: 64 * 1024 * 1024,
    maxScanUnits: 64 * 1024 * 1024,
    maxEntityCount: 1_000_000,
    maxMetadataUtf8Bytes: 64 * 1024,
  });

interface EncodedMetadata {
  readonly fileName: string;
  readonly timestamp: string;
  readonly productId: string;
  readonly productName: string;
  readonly productDescription: string;
}

interface Lexeme {
  readonly start: number;
  readonly end: number;
}

interface StepStringSpan extends Lexeme {
  readonly utf8Bytes: number;
}

interface ScannedArguments {
  readonly count: number;
  readonly directStrings: readonly (StepStringSpan | undefined)[];
  readonly stringCount: number;
  readonly firstString: StepStringSpan | undefined;
}

interface Replacement extends Lexeme {
  readonly value: string;
  readonly oldUtf8Bytes: number;
}

interface MetadataBudget {
  readonly maximum: number;
  remaining: number;
}

const OcctStepArray = Array;
const OcctStepDOMException = DOMException;
const OcctStepRangeError = RangeError;
const OcctStepTypeError = TypeError;
const occtStepReflectApply = Reflect.apply;
const occtStepArrayIsArray = Array.isArray;
const occtStepArrayJoin = Array.prototype.join;
const occtStepArrayPush = Array.prototype.push;
const occtStepNumberIsSafeInteger = Number.isSafeInteger;
const occtStepNumberToString = Number.prototype.toString;
const occtStepObjectGetOwnPropertyDescriptor =
  Object.getOwnPropertyDescriptor;
const occtStepObjectHasOwn = Object.hasOwn;
const occtStepStringCharCodeAt = String.prototype.charCodeAt;
const occtStepStringPadStart = String.prototype.padStart;
const occtStepStringSlice = String.prototype.slice;
const occtStepStringToUpperCase = String.prototype.toUpperCase;
const occtStepAbortSignalAbortedGetter =
  typeof AbortSignal === "undefined"
    ? undefined
    : (
        occtStepReflectApply(
          occtStepObjectGetOwnPropertyDescriptor,
          Object,
          [AbortSignal.prototype, "aborted"],
        ) as PropertyDescriptor | undefined
      )?.get;

function abortError(): DOMException {
  return new OcctStepDOMException(
    "OCCT STEP metadata rewrite was aborted",
    "AbortError",
  );
}

function arrayPush<T>(values: T[], value: T): void {
  occtStepReflectApply(occtStepArrayPush, values, [value]);
}

function arrayJoin(values: readonly string[]): string {
  return occtStepReflectApply(
    occtStepArrayJoin,
    values,
    [""],
  ) as string;
}

function stringCharCodeAt(value: string, index: number): number {
  return occtStepReflectApply(
    occtStepStringCharCodeAt,
    value,
    [index],
  ) as number;
}

function stringSlice(
  value: string,
  start: number,
  end?: number,
): string {
  return occtStepReflectApply(
    occtStepStringSlice,
    value,
    end === undefined ? [start] : [start, end],
  ) as string;
}

function paddedUppercaseHex(value: number, width: number): string {
  const hexadecimal = occtStepReflectApply(
    occtStepNumberToString,
    value,
    [16],
  ) as string;
  const uppercase = occtStepReflectApply(
    occtStepStringToUpperCase,
    hexadecimal,
    [],
  ) as string;
  return occtStepReflectApply(
    occtStepStringPadStart,
    uppercase,
    [width, "0"],
  ) as string;
}

function abortSignalAborted(value: unknown): boolean {
  if (occtStepAbortSignalAbortedGetter === undefined) {
    throw new OcctStepTypeError(
      "OCCT STEP metadata signal is unsupported in this runtime",
    );
  }
  try {
    const aborted = occtStepReflectApply(
      occtStepAbortSignalAbortedGetter,
      value,
      [],
    );
    if (typeof aborted === "boolean") return aborted;
  } catch {
    // Report one stable boundary error below.
  }
  throw new OcctStepTypeError("OCCT STEP metadata signal must be an AbortSignal");
}

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal !== undefined && abortSignalAborted(signal)) {
    throw abortError();
  }
}

function objectRecord(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  try {
    return !(occtStepReflectApply(
      occtStepArrayIsArray,
      Array,
      [value],
    ) as boolean);
  } catch {
    throw new OcctStepTypeError(
      "OCCT STEP metadata value could not be inspected safely",
    );
  }
}

function ownDataValue(
  value: object,
  property: PropertyKey,
  label: string,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = occtStepReflectApply(
      occtStepObjectGetOwnPropertyDescriptor,
      Object,
      [value, property],
    ) as PropertyDescriptor | undefined;
  } catch {
    throw new OcctStepTypeError(`${label} could not be inspected safely`);
  }
  if (descriptor === undefined) return undefined;
  if (
    !(occtStepReflectApply(
      occtStepObjectHasOwn,
      Object,
      [descriptor, "value"],
    ) as boolean)
  ) {
    throw new OcctStepTypeError(`${label} must be an own data property`);
  }
  return descriptor.value;
}

function checkedPositiveSafeInteger(
  value: unknown,
  label: keyof ResolvedLimits,
): number {
  if (
    typeof value !== "number" ||
    !occtStepNumberIsSafeInteger(value) ||
    value <= 0
  ) {
    throw new OcctStepRangeError(
      `OCCT STEP metadata ${label} must be a positive safe integer`,
    );
  }
  return value;
}

function resolveLimits(value: unknown): ResolvedLimits {
  if (value !== undefined && !objectRecord(value)) {
    throw new OcctStepTypeError("OCCT STEP metadata limits must be an object");
  }
  const limits = value;
  return {
    maxInputCodeUnits: checkedPositiveSafeInteger(
      (limits === undefined
        ? undefined
        : ownDataValue(
            limits,
            "maxInputCodeUnits",
            "OCCT STEP metadata limits.maxInputCodeUnits",
          )) ??
        DEFAULT_OCCT_STEP_METADATA_LIMITS.maxInputCodeUnits,
      "maxInputCodeUnits",
    ),
    maxOutputUtf8Bytes: checkedPositiveSafeInteger(
      (limits === undefined
        ? undefined
        : ownDataValue(
            limits,
            "maxOutputUtf8Bytes",
            "OCCT STEP metadata limits.maxOutputUtf8Bytes",
          )) ??
        DEFAULT_OCCT_STEP_METADATA_LIMITS.maxOutputUtf8Bytes,
      "maxOutputUtf8Bytes",
    ),
    maxScanUnits: checkedPositiveSafeInteger(
      (limits === undefined
        ? undefined
        : ownDataValue(
            limits,
            "maxScanUnits",
            "OCCT STEP metadata limits.maxScanUnits",
          )) ??
        DEFAULT_OCCT_STEP_METADATA_LIMITS.maxScanUnits,
      "maxScanUnits",
    ),
    maxEntityCount: checkedPositiveSafeInteger(
      (limits === undefined
        ? undefined
        : ownDataValue(
            limits,
            "maxEntityCount",
            "OCCT STEP metadata limits.maxEntityCount",
          )) ??
        DEFAULT_OCCT_STEP_METADATA_LIMITS.maxEntityCount,
      "maxEntityCount",
    ),
    maxMetadataUtf8Bytes: checkedPositiveSafeInteger(
      (limits === undefined
        ? undefined
        : ownDataValue(
            limits,
            "maxMetadataUtf8Bytes",
            "OCCT STEP metadata limits.maxMetadataUtf8Bytes",
          )) ??
        DEFAULT_OCCT_STEP_METADATA_LIMITS.maxMetadataUtf8Bytes,
      "maxMetadataUtf8Bytes",
    ),
  };
}

function checkedSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  abortSignalAborted(value);
  return value as AbortSignal;
}

function checkedStepMetadataString(
  value: unknown,
  label: keyof OcctStepMetadata,
  budget: MetadataBudget,
  signal: AbortSignal | undefined,
): string {
  if (typeof value !== "string") {
    throw new OcctStepTypeError(`OCCT STEP metadata ${label} must be a string`);
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = stringCharCodeAt(value, index);
    let utf8Bytes: number;
    if (code >= 0xd800 && code <= 0xdbff) {
      const following = stringCharCodeAt(value, index + 1);
      if (
        index + 1 >= value.length ||
        following < 0xdc00 ||
        following > 0xdfff
      ) {
        throw new OcctStepTypeError(
          `OCCT STEP metadata ${label} must not contain unpaired surrogates`,
        );
      }
      utf8Bytes = 4;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new OcctStepTypeError(
        `OCCT STEP metadata ${label} must not contain unpaired surrogates`,
      );
    } else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      throw new OcctStepTypeError(
        `OCCT STEP metadata ${label} must not contain control characters`,
      );
    } else if (code <= 0x7f) {
      utf8Bytes = 1;
    } else if (code <= 0x7ff) {
      utf8Bytes = 2;
    } else {
      utf8Bytes = 3;
    }

    if (utf8Bytes > budget.remaining) {
      throw new OcctStepRangeError(
        `OCCT STEP metadata exceeds maxMetadataUtf8Bytes ${budget.maximum}`,
      );
    }
    budget.remaining -= utf8Bytes;
    if ((index & 0x3ff) === 0) checkAbort(signal);
  }
  return value;
}

function encodeStepMetadataString(
  value: string,
  signal: AbortSignal | undefined,
): string {
  const pieces = new OcctStepArray<string>();
  arrayPush(pieces, "'");
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = stringCharCodeAt(value, index);
    if (code >= 0x20 && code <= 0x7e && code !== 0x27 && code !== 0x5c) {
      continue;
    }

    arrayPush(pieces, stringSlice(value, start, index));
    if (code === 0x27) {
      arrayPush(pieces, "''");
    } else if (code === 0x5c) {
      arrayPush(pieces, "\\X2\\005C\\X0\\");
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const following = stringCharCodeAt(value, index + 1);
      const scalar =
        0x10000 + ((code - 0xd800) << 10) + (following - 0xdc00);
      arrayPush(
        pieces,
        `\\X4\\${paddedUppercaseHex(scalar, 8)}\\X0\\`,
      );
      index += 1;
    } else {
      arrayPush(
        pieces,
        `\\X2\\${paddedUppercaseHex(code, 4)}\\X0\\`,
      );
    }
    start = index + 1;
    if ((index & 0x3ff) === 0) checkAbort(signal);
  }
  arrayPush(pieces, stringSlice(value, start));
  arrayPush(pieces, "'");
  return arrayJoin(pieces);
}

function decimalAt(value: string, index: number): number {
  return stringCharCodeAt(value, index) - 0x30;
}

function decimalPairAt(value: string, index: number): number {
  return decimalAt(value, index) * 10 + decimalAt(value, index + 1);
}

function checkedTimestamp(
  value: unknown,
  budget: MetadataBudget,
  signal: AbortSignal | undefined,
): string {
  const checked = checkedStepMetadataString(
    value,
    "timestamp",
    budget,
    signal,
  );
  if (typeof value !== "string" || value.length !== 19) {
    throw new OcctStepTypeError(
      "OCCT STEP metadata timestamp must use YYYY-MM-DDTHH:MM:SS",
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    if (index === 4 || index === 7) {
      if (stringCharCodeAt(value, index) !== 0x2d) {
        throw new OcctStepTypeError(
          "OCCT STEP metadata timestamp must use YYYY-MM-DDTHH:MM:SS",
        );
      }
      continue;
    }
    if (index === 10) {
      if (stringCharCodeAt(value, index) !== 0x54) {
        throw new OcctStepTypeError(
          "OCCT STEP metadata timestamp must use YYYY-MM-DDTHH:MM:SS",
        );
      }
      continue;
    }
    if (index === 13 || index === 16) {
      if (stringCharCodeAt(value, index) !== 0x3a) {
        throw new OcctStepTypeError(
          "OCCT STEP metadata timestamp must use YYYY-MM-DDTHH:MM:SS",
        );
      }
      continue;
    }
    if (!isDigit(stringCharCodeAt(value, index))) {
      throw new OcctStepTypeError(
        "OCCT STEP metadata timestamp must use YYYY-MM-DDTHH:MM:SS",
      );
    }
  }

  const year =
    decimalAt(value, 0) * 1_000 +
    decimalAt(value, 1) * 100 +
    decimalAt(value, 2) * 10 +
    decimalAt(value, 3);
  const month = decimalPairAt(value, 5);
  const day = decimalPairAt(value, 8);
  const hour = decimalPairAt(value, 11);
  const minute = decimalPairAt(value, 14);
  const second = decimalPairAt(value, 17);
  const leapYear =
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays =
    month === 2
      ? leapYear
        ? 29
        : 28
      : month === 4 || month === 6 || month === 9 || month === 11
        ? 30
        : 31;
  if (
    year === 0 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > monthDays ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new OcctStepTypeError(
      "OCCT STEP metadata timestamp is outside the supported calendar range",
    );
  }
  return checked;
}

function checkedMetadata(
  value: unknown,
  maximumBytes: number,
  signal: AbortSignal | undefined,
): EncodedMetadata {
  if (!objectRecord(value)) {
    throw new OcctStepTypeError("OCCT STEP metadata must be an object");
  }
  checkAbort(signal);
  const rawFileName = ownDataValue(
    value,
    "fileName",
    "OCCT STEP metadata fileName",
  );
  const rawTimestamp = ownDataValue(
    value,
    "timestamp",
    "OCCT STEP metadata timestamp",
  );
  const rawProductId = ownDataValue(
    value,
    "productId",
    "OCCT STEP metadata productId",
  );
  const rawProductName = ownDataValue(
    value,
    "productName",
    "OCCT STEP metadata productName",
  );
  const rawProductDescription = ownDataValue(
    value,
    "productDescription",
    "OCCT STEP metadata productDescription",
  );
  const budget: MetadataBudget = {
    maximum: maximumBytes,
    remaining: maximumBytes,
  };
  const fileName = checkedStepMetadataString(
    rawFileName,
    "fileName",
    budget,
    signal,
  );
  const timestamp = checkedTimestamp(rawTimestamp, budget, signal);
  const productId = checkedStepMetadataString(
    rawProductId,
    "productId",
    budget,
    signal,
  );
  const productName = checkedStepMetadataString(
    rawProductName,
    "productName",
    budget,
    signal,
  );
  const productDescription = checkedStepMetadataString(
    rawProductDescription,
    "productDescription",
    budget,
    signal,
  );
  if (
    fileName.length === 0 ||
    productId.length === 0 ||
    productName.length === 0
  ) {
    throw new OcctStepTypeError(
      "OCCT STEP metadata fileName, productId, and productName must be nonempty",
    );
  }
  return {
    fileName: encodeStepMetadataString(fileName, signal),
    timestamp: encodeStepMetadataString(timestamp, signal),
    productId: encodeStepMetadataString(productId, signal),
    productName: encodeStepMetadataString(productName, signal),
    productDescription: encodeStepMetadataString(productDescription, signal),
  };
}

function isWhitespace(code: number): boolean {
  return (
    code === 0x20 ||
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0c ||
    code === 0x0d
  );
}

function isUppercaseLetter(code: number): boolean {
  return code >= 0x41 && code <= 0x5a;
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function isIdentifierContinuation(code: number): boolean {
  return isUppercaseLetter(code) || isDigit(code) || code === 0x5f;
}

function isHexDigit(code: number): boolean {
  return isDigit(code) || (code >= 0x41 && code <= 0x46);
}

function isParameterCode(code: number): boolean {
  return (
    isIdentifierContinuation(code) ||
    code === 0x23 ||
    code === 0x24 ||
    code === 0x2a ||
    code === 0x2b ||
    code === 0x2d ||
    code === 0x2e
  );
}

class StepScanner {
  readonly source: string;
  readonly signal: AbortSignal | undefined;
  readonly maxScanUnits: number;
  index = 0;
  scanUnits = 0;
  sourceUtf8Bytes = 0;

  constructor(
    source: string,
    signal: AbortSignal | undefined,
    maxScanUnits: number,
  ) {
    this.source = source;
    this.signal = signal;
    this.maxScanUnits = maxScanUnits;
  }

  get atEnd(): boolean {
    return this.index === this.source.length;
  }

  codeAt(offset = 0): number {
    return stringCharCodeAt(this.source, this.index + offset);
  }

  advance(): number {
    if (this.index >= this.source.length) {
      throw new OcctStepTypeError("OCCT STEP document ended unexpectedly");
    }
    this.scanUnits += 1;
    if (this.scanUnits > this.maxScanUnits) {
      throw new OcctStepRangeError(
        `OCCT STEP metadata scan exceeds maxScanUnits ${this.maxScanUnits}`,
      );
    }

    const code = stringCharCodeAt(this.source, this.index);
    if (code <= 0x7f) {
      this.sourceUtf8Bytes += 1;
    } else if (code <= 0x7ff) {
      this.sourceUtf8Bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const following = stringCharCodeAt(this.source, this.index + 1);
      this.sourceUtf8Bytes +=
        following >= 0xdc00 && following <= 0xdfff ? 4 : 3;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      const preceding = stringCharCodeAt(this.source, this.index - 1);
      if (!(preceding >= 0xd800 && preceding <= 0xdbff)) {
        this.sourceUtf8Bytes += 3;
      }
    } else {
      this.sourceUtf8Bytes += 3;
    }

    this.index += 1;
    if ((this.scanUnits & 0x3ff) === 0) checkAbort(this.signal);
    return code;
  }

  expectCode(expected: number, label: string): void {
    if (this.codeAt() !== expected) {
      throw new OcctStepTypeError(`Malformed OCCT STEP document: expected ${label}`);
    }
    this.advance();
  }

  expectLiteral(expected: string, label: string): void {
    for (let index = 0; index < expected.length; index += 1) {
      if (this.codeAt() !== stringCharCodeAt(expected, index)) {
        throw new OcctStepTypeError(`Malformed OCCT STEP document: expected ${label}`);
      }
      this.advance();
    }
  }

  skipTrivia(): void {
    while (!this.atEnd) {
      const code = this.codeAt();
      if (isWhitespace(code)) {
        this.advance();
        continue;
      }
      if (code !== 0x2f || this.codeAt(1) !== 0x2a) return;
      this.advance();
      this.advance();
      let closed = false;
      while (!this.atEnd) {
        if (this.codeAt() === 0x2a && this.codeAt(1) === 0x2f) {
          this.advance();
          this.advance();
          closed = true;
          break;
        }
        if (this.codeAt() === 0) {
          throw new OcctStepTypeError("Malformed OCCT STEP document: NUL in comment");
        }
        this.advance();
      }
      if (!closed) {
        throw new OcctStepTypeError(
          "Malformed OCCT STEP document: unterminated comment",
        );
      }
    }
  }

  readIdentifier(label: string): Lexeme {
    const start = this.index;
    if (!isUppercaseLetter(this.codeAt())) {
      throw new OcctStepTypeError(`Malformed OCCT STEP document: expected ${label}`);
    }
    this.advance();
    while (isIdentifierContinuation(this.codeAt())) this.advance();
    return { start, end: this.index };
  }

  scanStepString(captureSpan: boolean): StepStringSpan | undefined {
    const start = captureSpan ? this.index : 0;
    const byteStart = captureSpan ? this.sourceUtf8Bytes : 0;
    this.expectCode(0x27, "STEP string");
    while (!this.atEnd) {
      const code = this.codeAt();
      if (code === 0x27) {
        this.advance();
        if (this.codeAt() === 0x27) {
          this.advance();
          continue;
        }
        return captureSpan
          ? {
              start,
              end: this.index,
              utf8Bytes: this.sourceUtf8Bytes - byteStart,
            }
          : undefined;
      }
      if (code < 0x20 || code === 0x7f) {
        throw new OcctStepTypeError(
          "Malformed OCCT STEP document: control character in STEP string",
        );
      }
      this.advance();
    }
    throw new OcctStepTypeError(
      "Malformed OCCT STEP document: unterminated STEP string",
    );
  }

  scanBinary(): void {
    this.expectCode(0x22, "binary literal");
    let digits = 0;
    while (!this.atEnd && this.codeAt() !== 0x22) {
      if (!isHexDigit(this.codeAt())) {
        throw new OcctStepTypeError(
          "Malformed OCCT STEP document: invalid binary literal",
        );
      }
      digits += 1;
      this.advance();
    }
    if (digits === 0 || this.atEnd) {
      throw new OcctStepTypeError(
        "Malformed OCCT STEP document: unterminated binary literal",
      );
    }
    this.advance();
  }

  scanArguments(
    capturedArguments: number,
    captureStringSummary = false,
  ): ScannedArguments {
    this.expectCode(0x28, "'('");
    let depth = 1;
    let count = 0;
    let hasContent = false;
    let onlyString = true;
    let directString: StepStringSpan | undefined;
    const directStrings =
      new OcctStepArray<StepStringSpan | undefined>();
    let stringCount = 0;
    let firstString: StepStringSpan | undefined;

    const markNonStringContent = (): void => {
      hasContent = true;
      onlyString = false;
      directString = undefined;
    };

    const finishArgument = (): void => {
      if (!hasContent) {
        throw new OcctStepTypeError(
          "Malformed OCCT STEP document: empty parameter",
        );
      }
      if (count < capturedArguments) {
        arrayPush(
          directStrings,
          onlyString ? directString : undefined,
        );
      }
      count += 1;
      hasContent = false;
      onlyString = true;
      directString = undefined;
    };

    while (!this.atEnd) {
      const code = this.codeAt();
      if (isWhitespace(code)) {
        this.advance();
        continue;
      }
      if (code === 0x2f && this.codeAt(1) === 0x2a) {
        this.skipTrivia();
        continue;
      }
      if (code === 0x2f) {
        throw new OcctStepTypeError(
          "Malformed OCCT STEP document: unexpected '/' in parameter list",
        );
      }
      if (code === 0x27) {
        const captureDirectString =
          depth === 1 && !hasContent && count < capturedArguments;
        const captureFirstString =
          captureStringSummary && stringCount === 0;
        const span = this.scanStepString(
          captureDirectString || captureFirstString,
        );
        stringCount += 1;
        if (captureFirstString) firstString = span;
        if (depth === 1) {
          if (hasContent) {
            onlyString = false;
            directString = undefined;
          } else {
            hasContent = true;
            directString = captureDirectString ? span : undefined;
          }
        }
        continue;
      }
      if (code === 0x22) {
        if (depth === 1) markNonStringContent();
        this.scanBinary();
        continue;
      }
      if (code === 0x28) {
        if (depth === 1) markNonStringContent();
        depth += 1;
        this.advance();
        continue;
      }
      if (code === 0x29) {
        if (depth === 1) {
          if (hasContent) {
            finishArgument();
          } else if (count !== 0) {
            throw new OcctStepTypeError(
              "Malformed OCCT STEP document: trailing empty parameter",
            );
          }
          this.advance();
          return { count, directStrings, stringCount, firstString };
        }
        depth -= 1;
        this.advance();
        continue;
      }
      if (code === 0x2c) {
        if (depth === 1) {
          finishArgument();
        }
        this.advance();
        continue;
      }
      if (code === 0x3b || code === 0x3d) {
        throw new OcctStepTypeError(
          "Malformed OCCT STEP document: unexpected structural punctuation in parameter list",
        );
      }
      if (code < 0x20 || code === 0x7f || !isParameterCode(code)) {
        throw new OcctStepTypeError(
          "Malformed OCCT STEP document: unsupported parameter token",
        );
      }
      if (depth === 1) markNonStringContent();
      this.advance();
    }
    throw new OcctStepTypeError(
      "Malformed OCCT STEP document: unterminated parameter list",
    );
  }
}

function lexemeEquals(
  scanner: StepScanner,
  lexeme: Lexeme,
  expected: string,
): boolean {
  if (lexeme.end - lexeme.start !== expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (
      stringCharCodeAt(scanner.source, lexeme.start + index) !==
      stringCharCodeAt(expected, index)
    ) {
      return false;
    }
  }
  return true;
}

function expectIdentifier(
  scanner: StepScanner,
  expected: string,
  label: string,
): void {
  const identifier = scanner.readIdentifier(label);
  if (!lexemeEquals(scanner, identifier, expected)) {
    throw new OcctStepTypeError(`Malformed OCCT STEP document: expected ${label}`);
  }
}

function targetString(
  arguments_: ScannedArguments,
  index: number,
  target: string,
): StepStringSpan {
  const span = arguments_.directStrings[index];
  if (span === undefined) {
    throw new OcctStepTypeError(
      `Malformed OCCT STEP document: ${target} argument ${index} must be one STEP string`,
    );
  }
  return span;
}

function addReplacement(
  replacements: Replacement[],
  span: StepStringSpan,
  value: string,
): void {
  arrayPush(replacements, {
    start: span.start,
    end: span.end,
    oldUtf8Bytes: span.utf8Bytes,
    value,
  });
}

function rewriteFileNameArguments(
  arguments_: ScannedArguments,
  metadata: EncodedMetadata,
  replacements: Replacement[],
): void {
  if (arguments_.count !== 7) {
    throw new OcctStepTypeError(
      "Malformed OCCT STEP document: FILE_NAME must have exactly 7 arguments",
    );
  }
  addReplacement(
    replacements,
    targetString(arguments_, 0, "FILE_NAME"),
    metadata.fileName,
  );
  addReplacement(
    replacements,
    targetString(arguments_, 1, "FILE_NAME"),
    metadata.timestamp,
  );
}

function rewriteProductArguments(
  arguments_: ScannedArguments,
  metadata: EncodedMetadata,
  replacements: Replacement[],
): void {
  if (arguments_.count !== 4) {
    throw new OcctStepTypeError(
      "Malformed OCCT STEP document: PRODUCT must have exactly 4 arguments",
    );
  }
  addReplacement(
    replacements,
    targetString(arguments_, 0, "PRODUCT"),
    metadata.productId,
  );
  addReplacement(
    replacements,
    targetString(arguments_, 1, "PRODUCT"),
    metadata.productName,
  );
  addReplacement(
    replacements,
    targetString(arguments_, 2, "PRODUCT"),
    metadata.productDescription,
  );
}

function scanHeader(
  scanner: StepScanner,
  metadata: EncodedMetadata,
  replacements: Replacement[],
): void {
  let fileNameCount = 0;
  let fileSchemaCount = 0;
  while (true) {
    scanner.skipTrivia();
    if (scanner.atEnd) {
      throw new OcctStepTypeError(
        "Malformed OCCT STEP document: unterminated HEADER section",
      );
    }
    const name = scanner.readIdentifier("HEADER record or ENDSEC");
    if (lexemeEquals(scanner, name, "ENDSEC")) {
      scanner.skipTrivia();
      scanner.expectCode(0x3b, "';'");
      break;
    }
    if (lexemeEquals(scanner, name, "PRODUCT")) {
      throw new OcctStepTypeError(
        "Malformed OCCT STEP document: PRODUCT is only valid in DATA",
      );
    }

    scanner.skipTrivia();
    const isFileName = lexemeEquals(scanner, name, "FILE_NAME");
    const isFileSchema = lexemeEquals(scanner, name, "FILE_SCHEMA");
    const arguments_ = scanner.scanArguments(
      isFileName ? 7 : 0,
      isFileSchema,
    );
    if (isFileName) {
      fileNameCount += 1;
      if (fileNameCount !== 1) {
        throw new OcctStepTypeError(
          "Malformed OCCT STEP document: multiple HEADER FILE_NAME records",
        );
      }
      rewriteFileNameArguments(arguments_, metadata, replacements);
    }
    if (isFileSchema) {
      fileSchemaCount += 1;
      if (fileSchemaCount !== 1) {
        throw new OcctStepTypeError(
          "Malformed OCCT STEP document: multiple HEADER FILE_SCHEMA records",
        );
      }
      const schema = arguments_.firstString;
      if (
        arguments_.count !== 1 ||
        arguments_.stringCount !== 1 ||
        schema === undefined ||
        !lexemeEquals(
          scanner,
          schema,
          "'AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'",
        )
      ) {
        throw new OcctStepTypeError(
          "Malformed OCCT STEP document: FILE_SCHEMA must declare the supported AP214IS profile",
        );
      }
    }
    scanner.skipTrivia();
    scanner.expectCode(0x3b, "';'");
  }
  if (fileNameCount !== 1) {
    throw new OcctStepTypeError(
      "Malformed OCCT STEP document: missing HEADER FILE_NAME record",
    );
  }
  if (fileSchemaCount !== 1) {
    throw new OcctStepTypeError(
      "Malformed OCCT STEP document: missing HEADER FILE_SCHEMA record",
    );
  }
}

function scanDataRecord(
  scanner: StepScanner,
  metadata: EncodedMetadata,
  replacements: Replacement[],
): boolean {
  const name = scanner.readIdentifier("DATA entity name");
  if (lexemeEquals(scanner, name, "FILE_NAME")) {
    throw new OcctStepTypeError(
      "Malformed OCCT STEP document: FILE_NAME is only valid in HEADER",
    );
  }
  const isProduct = lexemeEquals(scanner, name, "PRODUCT");
  scanner.skipTrivia();
  const arguments_ = scanner.scanArguments(isProduct ? 4 : 0);
  if (isProduct) {
    rewriteProductArguments(arguments_, metadata, replacements);
  }
  return isProduct;
}

function scanData(
  scanner: StepScanner,
  metadata: EncodedMetadata,
  replacements: Replacement[],
  maximumEntities: number,
): void {
  let entityCount = 0;
  let productCount = 0;
  while (true) {
    scanner.skipTrivia();
    if (scanner.atEnd) {
      throw new OcctStepTypeError(
        "Malformed OCCT STEP document: unterminated DATA section",
      );
    }
    if (isUppercaseLetter(scanner.codeAt())) {
      const end = scanner.readIdentifier("ENDSEC");
      if (!lexemeEquals(scanner, end, "ENDSEC")) {
        throw new OcctStepTypeError(
          "Malformed OCCT STEP document: expected DATA entity or ENDSEC",
        );
      }
      scanner.skipTrivia();
      scanner.expectCode(0x3b, "';'");
      break;
    }

    scanner.expectCode(0x23, "'#'");
    let identifierDigits = 0;
    while (isDigit(scanner.codeAt())) {
      identifierDigits += 1;
      scanner.advance();
    }
    if (identifierDigits === 0) {
      throw new OcctStepTypeError(
        "Malformed OCCT STEP document: DATA entity identifier requires digits",
      );
    }
    entityCount += 1;
    if (entityCount > maximumEntities) {
      throw new OcctStepRangeError(
        `OCCT STEP metadata scan exceeds maxEntityCount ${maximumEntities}`,
      );
    }

    scanner.skipTrivia();
    scanner.expectCode(0x3d, "'='");
    scanner.skipTrivia();
    if (scanner.codeAt() === 0x28) {
      scanner.advance();
      scanner.skipTrivia();
      let records = 0;
      while (scanner.codeAt() !== 0x29) {
        if (scanner.atEnd) {
          throw new OcctStepTypeError(
            "Malformed OCCT STEP document: unterminated complex DATA entity",
          );
        }
        if (!isUppercaseLetter(scanner.codeAt())) {
          throw new OcctStepTypeError(
            "Malformed OCCT STEP document: expected complex DATA record",
          );
        }
        if (scanDataRecord(scanner, metadata, replacements)) {
          productCount += 1;
          if (productCount !== 1) {
            throw new OcctStepTypeError(
              "Malformed OCCT STEP document: multiple DATA PRODUCT records",
            );
          }
        }
        records += 1;
        scanner.skipTrivia();
      }
      if (records === 0) {
        throw new OcctStepTypeError(
          "Malformed OCCT STEP document: empty complex DATA entity",
        );
      }
      scanner.advance();
    } else {
      if (scanDataRecord(scanner, metadata, replacements)) {
        productCount += 1;
        if (productCount !== 1) {
          throw new OcctStepTypeError(
            "Malformed OCCT STEP document: multiple DATA PRODUCT records",
          );
        }
      }
    }
    scanner.skipTrivia();
    scanner.expectCode(0x3b, "';'");
  }
  if (productCount !== 1) {
    throw new OcctStepTypeError(
      "Malformed OCCT STEP document: missing DATA PRODUCT record",
    );
  }
}

function applyReplacements(
  source: string,
  replacements: readonly Replacement[],
): string {
  const pieces = new OcctStepArray<string>();
  let cursor = 0;
  for (let index = 0; index < replacements.length; index += 1) {
    const replacement = replacements[index]!;
    if (replacement.start < cursor || replacement.end < replacement.start) {
      throw new OcctStepTypeError("OCCT STEP metadata replacement spans overlap");
    }
    arrayPush(
      pieces,
      stringSlice(source, cursor, replacement.start),
    );
    arrayPush(pieces, replacement.value);
    cursor = replacement.end;
  }
  arrayPush(pieces, stringSlice(source, cursor));
  return arrayJoin(pieces);
}

function prepareOcctStepMetadataRewrite(
  options: RewriteOcctStepMetadataOptions,
): PreparedOcctStepMetadataRewrite {
  if (!objectRecord(options)) {
    throw new OcctStepTypeError("OCCT STEP metadata options must be an object");
  }
  const rawLimits = ownDataValue(
    options,
    "limits",
    "OCCT STEP metadata options.limits",
  );
  const rawSignal = ownDataValue(
    options,
    "signal",
    "OCCT STEP metadata options.signal",
  );
  const rawMetadata = ownDataValue(
    options,
    "metadata",
    "OCCT STEP metadata options.metadata",
  );
  const limits = resolveLimits(rawLimits);
  const signal = checkedSignal(rawSignal);
  checkAbort(signal);
  const metadata = checkedMetadata(
    rawMetadata,
    limits.maxMetadataUtf8Bytes,
    signal,
  );
  checkAbort(signal);
  return { metadata, signal, limits };
}

function rewritePreparedOcctStepMetadata(
  source: string,
  prepared: PreparedOcctStepMetadataRewrite,
): string {
  const { limits, metadata, signal } = prepared;
  if (typeof source !== "string") {
    throw new OcctStepTypeError("OCCT STEP metadata source must be a string");
  }
  checkAbort(signal);
  if (source.length > limits.maxInputCodeUnits) {
    throw new OcctStepRangeError(
      `OCCT STEP metadata source exceeds maxInputCodeUnits ${limits.maxInputCodeUnits}`,
    );
  }
  const scanner = new StepScanner(source, signal, limits.maxScanUnits);
  const replacements = new OcctStepArray<Replacement>();

  scanner.skipTrivia();
  scanner.expectLiteral("ISO-10303-21", "ISO-10303-21");
  scanner.skipTrivia();
  scanner.expectCode(0x3b, "';'");
  scanner.skipTrivia();
  expectIdentifier(scanner, "HEADER", "HEADER");
  scanner.skipTrivia();
  scanner.expectCode(0x3b, "';'");
  scanHeader(scanner, metadata, replacements);
  scanner.skipTrivia();
  expectIdentifier(scanner, "DATA", "DATA");
  scanner.skipTrivia();
  scanner.expectCode(0x3b, "';'");
  scanData(
    scanner,
    metadata,
    replacements,
    limits.maxEntityCount,
  );
  scanner.skipTrivia();
  scanner.expectLiteral("END-ISO-10303-21", "END-ISO-10303-21");
  scanner.skipTrivia();
  scanner.expectCode(0x3b, "';'");
  scanner.skipTrivia();
  if (!scanner.atEnd) {
    throw new OcctStepTypeError(
      "Malformed OCCT STEP document: trailing content after exchange structure",
    );
  }
  checkAbort(signal);

  let outputBytes = scanner.sourceUtf8Bytes;
  for (let index = 0; index < replacements.length; index += 1) {
    const replacement = replacements[index]!;
    outputBytes += replacement.value.length - replacement.oldUtf8Bytes;
  }
  if (outputBytes > limits.maxOutputUtf8Bytes) {
    throw new OcctStepRangeError(
      `OCCT STEP metadata output exceeds maxOutputUtf8Bytes (maxOutputBytes) ${limits.maxOutputUtf8Bytes}`,
    );
  }
  const output = applyReplacements(source, replacements);
  checkAbort(signal);
  return output;
}

/**
 * Rewrites only the deterministic identity fields in one OCCT Part-21 file.
 *
 * The scanner accepts the exact ISO-10303-21 envelope, one HEADER section with
 * one direct FILE_NAME record, and one DATA section containing one PRODUCT
 * record. It preserves all bytes outside the five STEP string tokens it
 * replaces. Printable ASCII is preserved, apostrophes are doubled, and
 * reverse solidus plus non-ASCII Unicode scalars use Part-21 X2/X4 escapes.
 */
export function rewriteOcctStepMetadata(
  source: string,
  options: RewriteOcctStepMetadataOptions,
): string {
  return rewritePreparedOcctStepMetadata(
    source,
    prepareOcctStepMetadataRewrite(options),
  );
}

/**
 * Validates and encodes metadata before invoking a synchronous STEP writer,
 * then structurally rewrites the returned Part-21 document.
 */
export function rewriteOcctStepMetadataFromSource(
  source: () => string,
  options: RewriteOcctStepMetadataOptions,
): string {
  if (typeof source !== "function") {
    throw new OcctStepTypeError("OCCT STEP metadata source must be a function");
  }
  const prepared = prepareOcctStepMetadataRewrite(options);
  checkAbort(prepared.signal);
  const document = source();
  checkAbort(prepared.signal);
  return rewritePreparedOcctStepMetadata(document, prepared);
}
