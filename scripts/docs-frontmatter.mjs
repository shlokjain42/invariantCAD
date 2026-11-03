// Frontmatter rules shared by the documentation gate and its tests.

const frontmatterPattern = /^---\n([\s\S]*?)\n---\n/;
const doubleQuotedPattern = /^"((?:[^"\\]|\\.)*)"(?:[ \t]+#.*)?$/;
const singleQuotedPattern = /^'((?:[^']|'')*)'(?:[ \t]+#.*)?$/;
const nullPattern = /^(?:~|null|Null|NULL)$/;
const doubleQuotedEscape = /\\(?:x([\da-fA-F]{2})|u([\da-fA-F]{4})|U([\da-fA-F]{8})|(.))/gs;
// YAML 1.2 double-quoted single-character escapes.
const simpleEscapes = new Map([
  ["0", "\0"],
  ["a", "\x07"],
  ["b", "\b"],
  ["t", "\t"],
  ["\t", "\t"],
  ["n", "\n"],
  ["v", "\v"],
  ["f", "\f"],
  ["r", "\r"],
  ["e", "\x1b"],
  [" ", " "],
  ['"', '"'],
  ["/", "/"],
  ["\\", "\\"],
  ["N", "\u0085"],
  ["_", "\u00a0"],
  ["L", "\u2028"],
  ["P", "\u2029"],
]);

/** Returns a page's leading YAML frontmatter block, or undefined. */
export function pageFrontmatter(pageText) {
  return frontmatterPattern.exec(pageText)?.[1];
}

// Decodes the escapes of a double-quoted value, or returns undefined when one
// is not a YAML escape, which makes the whole document invalid YAML.
function decodeDoubleQuoted(text) {
  let valid = true;
  const decoded = text.replace(
    doubleQuotedEscape,
    (_escape, byte, unit, codePoint, character) => {
      const hex = byte ?? unit ?? codePoint;
      if (hex !== undefined) {
        const value = Number.parseInt(hex, 16);
        if (value <= 0x10ffff) return String.fromCodePoint(value);
      } else if (simpleEscapes.has(character)) {
        return simpleEscapes.get(character);
      }
      valid = false;
      return "";
    },
  );
  return valid ? decoded : undefined;
}

function plainScalar(text) {
  const plain = text.replace(/(?:^|[ \t]+)#.*$/, "").trimEnd();
  if (
    plain === "" ||
    nullPattern.test(plain) ||
    /^[,[\]{}#&*!|>%@`]/.test(plain) ||
    /^[-?:](?:[ \t]|$)/.test(plain) ||
    /:(?:[ \t]|$)/.test(plain)
  ) {
    return undefined;
  }
  return plain;
}

// YAML continues a key's value on following more-indented lines, so a value
// is single-line only when the next line that is neither blank nor a comment
// starts a new top-level entry. Comment lines are skipped rather than ending
// the search, because indented content after one still belongs to no other
// key.
function continuesOnNextLine(lines, keyIndex) {
  for (const line of lines.slice(keyIndex + 1)) {
    const content = line.trim();
    if (content === "" || content.startsWith("#")) continue;
    return /^[ \t]/.test(line);
  }
  return false;
}

/**
 * Returns the single-line scalar value of one top-level frontmatter key,
 * with surrounding quotes removed and escapes left as written. Returns
 * undefined when the key is missing or repeated, or when its value is blank
 * (after decoding double-quoted escapes), null, a block scalar, continued on
 * another line, not a plain or quoted single-line string, or a double-quoted
 * string with an escape that YAML does not define.
 */
export function frontmatterScalar(frontmatter, field) {
  const prefix = `${field}:`;
  const lines = frontmatter.split("\n");
  const keyIndexes = [];
  lines.forEach((line, index) => {
    if (line.startsWith(prefix)) keyIndexes.push(index);
  });
  if (keyIndexes.length !== 1) return undefined;
  const keyIndex = keyIndexes[0];
  if (continuesOnNextLine(lines, keyIndex)) return undefined;
  const rest = lines[keyIndex].slice(prefix.length);
  if (rest !== "" && !/^[ \t]/.test(rest)) return undefined;
  const text = rest.trim();
  const doubleQuoted = doubleQuotedPattern.exec(text)?.[1];
  if (doubleQuoted !== undefined) {
    // Blankness is judged on the decoded text, so "\u0020" and "\t" are
    // blank, but the value is returned as written.
    const decoded = decodeDoubleQuoted(doubleQuoted);
    return decoded === undefined || isBlank(decoded) ? undefined : doubleQuoted;
  }
  const value =
    singleQuotedPattern.exec(text)?.[1] ??
    (/^["']/.test(text) ? undefined : plainScalar(text));
  return value === undefined || isBlank(value) ? undefined : value;
}

// JavaScript whitespace plus YAML's next-line character, which trim() keeps.
function isBlank(value) {
  return /^[\s\u0085]*$/u.test(value);
}
