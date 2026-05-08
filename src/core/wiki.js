// Pure wiki/markdown/path helpers extracted from app.js.
//
// Scope (Phase 7 of the module-split refactor, executed before
// Phase 4 to give views/graph.js clean imports):
//   - Path identity: basename, isWikiPagePath, isSourceNodePagePath,
//     isPromotedWikiPagePath, isBucketOverviewPath
//   - Markdown body helpers: markdownTitle, hasYamlFrontmatter
//   - Slug helpers: slugifyLoose, titleFromSlug
//   - Frontmatter parsing: yamlScalar, frontmatterFields
//   - Tag normalization: normalizeEntityTag
//   - Misc render helper: warningLabel
//
// Out of scope (still in app.js):
//   - cleanYamlScalar, cleanExtractedSourceText, firstMatch — depend
//     on cleanSummary which lives in a separate cluster
//   - localReadableSourceText — moves with ingest pipeline
//   - wikiSchemaPack, wikiLinkTargetForPath — depend on richer state
//
// All functions here are pure: no DOM, no state, no localStorage.

// ---------------------------------------------------------------------
// Path identity
// ---------------------------------------------------------------------

export function basename(path) {
  return path.split("/").pop() || path;
}

export function isWikiPagePath(path) {
  return (/^wiki\/(sources|concepts|entities|synthesis)\/[^/]+\.md$/.test(path) ||
    /^wiki\/(ingest-tracker|log|wiki-stats)\.md$/.test(path) ||
    path === "wiki/index.md");
}

export function isSourceNodePagePath(path) {
  return path.startsWith("wiki/sources/") && !isBucketOverviewPath(path);
}

export function isPromotedWikiPagePath(path) {
  return (
    path.startsWith("wiki/concepts/") ||
    path.startsWith("wiki/entities/") ||
    path.startsWith("wiki/synthesis/")
  ) && !isBucketOverviewPath(path);
}

export function isBucketOverviewPath(path) {
  return /^wiki\/(sources\/sources|concepts\/concepts|entities\/entities|synthesis\/synthesis)\.md$/.test(path);
}

// ---------------------------------------------------------------------
// Markdown body
// ---------------------------------------------------------------------

export function markdownTitle(body) {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

export function hasYamlFrontmatter(body) {
  return /^---\n[\s\S]+?\n---\n/.test(body);
}

// ---------------------------------------------------------------------
// Slugs and titles
// ---------------------------------------------------------------------

export function slugifyLoose(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function titleFromSlug(slug) {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------

export function yamlScalar(value) {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

export function frontmatterFields(body) {
  const match = String(body || "").match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return {};
  const fields = {};
  let listKey = "";
  for (const line of match[1].split("\n")) {
    const item = line.match(/^\s*-\s*(.*)$/);
    if (listKey && item) {
      if (!Array.isArray(fields[listKey])) fields[listKey] = [];
      fields[listKey].push(yamlScalar(item[1]));
      continue;
    }
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) {
      listKey = "";
      continue;
    }
    const value = field[2].trim();
    if (!value) {
      fields[field[1]] = "";
      listKey = field[1];
      continue;
    }
    fields[field[1]] = yamlScalar(value);
    listKey = "";
  }
  return fields;
}

// ---------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------

export function normalizeEntityTag(tag) {
  return String(tag || "")
    .trim()
    .replace(/^#/, "")
    .replace(/^['"]|['"]$/g, "")
    .toLowerCase();
}

// ---------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------

export function warningLabel(warnings) {
  return warnings.length ? ` · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : "";
}
