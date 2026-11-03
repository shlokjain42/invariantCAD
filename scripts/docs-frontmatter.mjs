// Frontmatter rules shared by the documentation gate and its tests.

const frontmatterPattern = /^---\n([\s\S]*?)\n---\n/;
const doubleQuotedPattern = /^"((?:[^"\\]|\\.)*)"(?:[ \t]+#.*)?$/;
const singleQuotedPattern = /^'((?:[^']|'')*)'(?:[ \t]+#.*)?$/;
const nullPattern = /^(?:~|null|Null|NULL)$/;

/** Returns a page's leading YAML frontmatter block, or undefined. */
export function pageFrontmatter(pageText) {
  return frontmatterPattern.exec(pageText)?.[1];
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
// is single-line only when no indented line other than a comment follows it
// before the next top-level line.
function continuesOnNextLine(lines, keyIndex) {
  for (const line of lines.slice(keyIndex + 1)) {
    if (line.trim() === "") continue;
    return /^[ \t]+[^ \t#]/.test(line);
  }
  return false;
}

/**
 * Returns the single-line scalar value of one top-level frontmatter key,
 * with surrounding quotes removed and escapes left as written. Returns
 * undefined when the key is missing or repeated, or when its value is blank,
 * null, a block scalar, continued on another line, or not a plain or quoted
 * single-line string.
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
  const quoted =
    doubleQuotedPattern.exec(text)?.[1] ?? singleQuotedPattern.exec(text)?.[1];
  const value =
    quoted ?? (/^["']/.test(text) ? undefined : plainScalar(text));
  return value === undefined || value.trim() === "" ? undefined : value;
}
