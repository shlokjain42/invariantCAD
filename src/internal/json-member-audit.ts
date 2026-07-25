import type { DesignDocumentLimits } from "../document-limits.js";

/**
 * Raw JSON text is the only boundary that can distinguish repeated object
 * members after native parsing collapses them. This scanner assumes the caller
 * has already accepted the complete source with the captured native
 * `JSON.parse`; it audits member identity plus raw structural ceilings and does
 * not replace parsing.
 */

const JsonMemberAuditIntrinsicArray = Array;
const JsonMemberAuditIntrinsicJson = JSON;
const JsonMemberAuditIntrinsicReflect = Reflect;
const JsonMemberAuditIntrinsicSet = Set;
const jsonMemberAuditJsonParse = JsonMemberAuditIntrinsicJson.parse;
const jsonMemberAuditReflectApply = JsonMemberAuditIntrinsicReflect.apply;
const jsonMemberAuditSetAdd = JsonMemberAuditIntrinsicSet.prototype.add;
const jsonMemberAuditSetHas = JsonMemberAuditIntrinsicSet.prototype.has;
const jsonMemberAuditStringCharCodeAt = String.prototype.charCodeAt;
const jsonMemberAuditStringSlice = String.prototype.slice;

function jsonMemberAuditCharCodeAt(value: string, index: number): number {
  return jsonMemberAuditReflectApply(
    jsonMemberAuditStringCharCodeAt,
    value,
    [index],
  ) as number;
}

function jsonMemberAuditSlice(
  value: string,
  start: number,
  end: number,
): string {
  return jsonMemberAuditReflectApply(
    jsonMemberAuditStringSlice,
    value,
    [start, end],
  ) as string;
}

function jsonMemberAuditParseString(value: string): string {
  return jsonMemberAuditReflectApply(
    jsonMemberAuditJsonParse,
    JsonMemberAuditIntrinsicJson,
    [value],
  ) as string;
}

function jsonMemberAuditSetContains(
  members: Set<string>,
  member: string,
): boolean {
  return jsonMemberAuditReflectApply(
    jsonMemberAuditSetHas,
    members,
    [member],
  ) as boolean;
}

function jsonMemberAuditSetInsert(
  members: Set<string>,
  member: string,
): void {
  jsonMemberAuditReflectApply(jsonMemberAuditSetAdd, members, [member]);
}

function jsonMemberAuditStringEnd(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length) {
    const code = jsonMemberAuditCharCodeAt(source, index);
    if (code === 0x5c) {
      index += 2;
      continue;
    }
    index += 1;
    if (code === 0x22) return index;
  }
  return source.length;
}

function jsonMemberAuditIsWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function jsonMemberAuditPrimitiveEnd(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length) {
    const code = jsonMemberAuditCharCodeAt(source, index);
    if (
      code === 0x2c ||
      code === 0x5d ||
      code === 0x7d ||
      jsonMemberAuditIsWhitespace(code)
    ) {
      return index;
    }
    index += 1;
  }
  return source.length;
}

export type JsonMemberAuditResult =
  | {
      readonly status: "unique";
    }
  | {
      readonly status: "duplicate";
    }
  | {
      readonly status: "limit-exceeded";
      readonly resource: "maxStructuralValues" | "maxNestingDepth";
      readonly limit: number;
      readonly actual: number;
    };

/**
 * Reports whether any object scope in valid JSON text repeats a decoded member
 * name. The traversal is iterative, counts even values later erased by native
 * last-key-wins parsing, keeps scopes independent, and delegates escape
 * decoding to the captured native parser.
 */
export function auditJsonMemberNames(
  source: string,
  limits: Pick<
    DesignDocumentLimits,
    "maxStructuralValues" | "maxNestingDepth"
  >,
): JsonMemberAuditResult {
  const scopes = new JsonMemberAuditIntrinsicArray<Set<string> | null>();
  let structuralValues = 0;

  const countValue = (): JsonMemberAuditResult | undefined => {
    structuralValues += 1;
    if (structuralValues > limits.maxStructuralValues) {
      return {
        status: "limit-exceeded",
        resource: "maxStructuralValues",
        limit: limits.maxStructuralValues,
        actual: limits.maxStructuralValues + 1,
      };
    }
    const depth = scopes.length;
    return depth > limits.maxNestingDepth
      ? {
          status: "limit-exceeded",
          resource: "maxNestingDepth",
          limit: limits.maxNestingDepth,
          actual: depth,
        }
      : undefined;
  };

  let duplicate = false;
  let index = 0;
  while (index < source.length) {
    const code = jsonMemberAuditCharCodeAt(source, index);
    if (code === 0x7b) {
      const limit = countValue();
      if (limit !== undefined) return limit;
      scopes[scopes.length] = new JsonMemberAuditIntrinsicSet<string>();
      index += 1;
      continue;
    }
    if (code === 0x5b) {
      const limit = countValue();
      if (limit !== undefined) return limit;
      scopes[scopes.length] = null;
      index += 1;
      continue;
    }
    if (code === 0x7d || code === 0x5d) {
      scopes.length -= 1;
      index += 1;
      continue;
    }
    if (code !== 0x22) {
      if (
        code === 0x2d ||
        (code >= 0x30 && code <= 0x39) ||
        code === 0x66 ||
        code === 0x6e ||
        code === 0x74
      ) {
        const limit = countValue();
        if (limit !== undefined) return limit;
        index = jsonMemberAuditPrimitiveEnd(source, index);
      } else {
        index += 1;
      }
      continue;
    }

    const end = jsonMemberAuditStringEnd(source, index);
    let next = end;
    while (
      next < source.length &&
      jsonMemberAuditIsWhitespace(jsonMemberAuditCharCodeAt(source, next))
    ) {
      next += 1;
    }
    if (jsonMemberAuditCharCodeAt(source, next) === 0x3a) {
      const members = scopes[scopes.length - 1];
      if (members !== undefined && members !== null) {
        const member = jsonMemberAuditParseString(
          jsonMemberAuditSlice(source, index, end),
        );
        if (jsonMemberAuditSetContains(members, member)) {
          duplicate = true;
        } else {
          jsonMemberAuditSetInsert(members, member);
        }
      }
    } else {
      const limit = countValue();
      if (limit !== undefined) return limit;
    }
    index = end;
  }
  return { status: duplicate ? "duplicate" : "unique" };
}
