/** Returns a page's leading YAML frontmatter block, or undefined. */
export function pageFrontmatter(pageText: string): string | undefined;

/**
 * Returns the single-line scalar value of one top-level frontmatter key,
 * with surrounding quotes removed and escapes left as written. Returns
 * undefined when the key is missing or repeated, or when its value is blank,
 * null, a block scalar, or not a plain or quoted single-line string.
 */
export function frontmatterScalar(
  frontmatter: string,
  field: string,
): string | undefined;
