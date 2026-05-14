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
