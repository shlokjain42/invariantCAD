/** Returns a page's leading YAML frontmatter block, or undefined. */
export function pageFrontmatter(pageText: string): string | undefined;

/**
 * Returns the single-line scalar value of one top-level frontmatter key,
 * with surrounding quotes removed and escapes left as written. Returns
 * undefined when the key is missing or repeated, or when its value is blank
 * (after decoding double-quoted escapes), null, a block scalar, continued on
 * another line, not a plain or quoted single-line string, or a double-quoted
 * string with an escape that YAML does not define.
 */
export function frontmatterScalar(
  frontmatter: string,
  field: string,
): string | undefined;
