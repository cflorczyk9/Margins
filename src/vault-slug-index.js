// Shared slug → file index for vault-wide operations.
//
// Before this module, src/wikilinks.js rebuilt the slug map on every call:
// vault.listFiles() + per-file basename+priority computation. Fine when
// scanning one page. Catastrophic when scanning a folder of 600 pages —
// the same map is built 600 times. This module builds it once per call.
//
// The index has no automatic invalidation. Each caller decides whether to
// reuse an existing index across operations (within a single MCP tool call
// — safe) or build a fresh one (between tool calls — safe but slower). No
// cross-tool memoization; the proposal staging path mutates filenames in
// proposed/, so the next tool call may legitimately see a different index.
import path from "node:path";
import { pathPriority } from "./paths.js";

/**
 * Build a slug → file index for the entire vault.
 *
 * Returns:
 *   {
 *     slugToFile: Map<lowerSlug, { slug, rel, priority }>,
 *     totalSlugs: number,
 *     totalFiles: number,
 *   }
 *
 * Slug derivation:
 *   - basename without extension
 *   - leading "source-" prefix stripped (so wiki/sources/source-foo.md
 *     contributes slug "foo")
 *   - lowercased for the map key; original casing kept on the value
 *
 * Files with pathPriority <= 0 (fixtures, tests) are excluded so user-vault
 * pages never get linked to test data. Files with slug length < 3 are
 * excluded because two-character "slugs" produce noisy false-positives.
 *
 * Highest-priority target wins on slug collision. wiki/ (10) beats raw/
 * (5) beats wiki/_templates/ (1). On ties, first-found path wins.
 */
export async function buildSlugIndex(vault, options = {}) {
  const excludePath = options.excludePath ? String(options.excludePath) : null;
  const allFiles = await vault.listFiles();
  const slugToFile = new Map();
  for (const abs of allFiles) {
    const rel = vault.toRel(abs);
    if (excludePath && rel === excludePath) continue;
    const priority = pathPriority(rel);
    if (priority <= 0) continue;
    const base = path.basename(abs, path.extname(abs));
    const slug = base.replace(/^source-/, "");
    if (!slug || slug.length < 3) continue;
    const key = slug.toLowerCase();
    const existing = slugToFile.get(key);
    if (!existing || priority > existing.priority) {
      slugToFile.set(key, { slug, rel, priority });
    }
  }
  return {
    slugToFile,
    totalSlugs: slugToFile.size,
    totalFiles: allFiles.length
  };
}

/**
 * Convenience helper for callers that need a fresh index excluding a
 * specific page (e.g., propose_wikilinks doesn't want to suggest linking
 * a page to itself).
 */
export async function buildSlugIndexExcluding(vault, pagePath) {
  return buildSlugIndex(vault, { excludePath: pagePath });
}
