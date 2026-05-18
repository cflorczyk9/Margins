/**
 * Vault-relative path canonicalization.
 *
 * Two paths are "the same file" if their canonical forms are equal.
 * This is load-bearing for idempotency: a user could write
 *   raw_file: ./raw/foo.pdf
 * in frontmatter while the filesystem returns
 *   raw/foo.pdf
 * via vault.toRel(). Without normalization, the idempotency check misses
 * and Margins stages a duplicate proposal.
 *
 * Normalization steps:
 *   - Convert backslashes to forward slashes (Windows-authored paths)
 *   - Strip leading "./"
 *   - Collapse repeated slashes
 *   - Strip trailing slash
 *   - Normalize Unicode to NFC (macOS APFS may store NFD; canonical comparison
 *     form is NFC, which is what users typically type)
 *
 * Path-traversal rejection (".." escape) lives in vault.resolveInside; this
 * helper does not duplicate that.
 */
export function canonicalize(rel) {
  if (rel == null) return "";
  let s = String(rel);
  if (!s) return "";
  s = s.replace(/\\/g, "/");
  s = s.replace(/^\.\//, "");
  s = s.replace(/\/{2,}/g, "/");
  s = s.replace(/\/+$/, "");
  s = s.normalize("NFC");
  return s;
}

export function pathsEqual(a, b) {
  return canonicalize(a) === canonicalize(b);
}

/**
 * Content-priority for a vault-relative path.
 *
 * Higher = more likely to be the user's actual notes.
 * Used to rank search hits, backlink results, and wikilink slug targets so
 * that test fixtures, templates, and project source code don't drown out
 * the wiki/ pages a real user wants.
 *
 *   10  wiki/ pages (the gold)
 *    5  raw/ source documents
 *    3  other top-level content
 *    1  wiki/_templates/ (templates, not real pages)
 *    1  margins/, gstack/, agents/ (project source, not user notes)
 *    0  any path under tests/fixtures/ or test/fixtures/ (fixtures)
 */
export function pathPriority(rel) {
  const r = canonicalize(rel);
  if (!r) return 0;
  if (/(^|\/)(tests?|spec)\/fixtures\//.test(r)) return 0;
  if (/(^|\/)fixtures\//.test(r)) return 0;
  if (r.startsWith("wiki/_templates/")) return 1;
  if (r.startsWith("wiki/")) return 10;
  if (r.startsWith("raw/")) return 5;
  if (
    r.startsWith("margins/") ||
    r.startsWith("gstack/") ||
    r.startsWith("agents/") ||
    r.startsWith("code/")
  ) {
    return 1;
  }
  return 3;
}
