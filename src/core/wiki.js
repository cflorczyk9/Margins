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
// Generic string cleaners (used by frontmatter/source/markdown)
// ---------------------------------------------------------------------

export function cleanSummary(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .trim();
}

export function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function cleanTag(value) {
  return String(value || "")
    .trim()
    .replace(/^#/, "")
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_/-]/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();
}

// ---------------------------------------------------------------------
// Markdown body extraction / cleanup
// ---------------------------------------------------------------------

export function bodyWithoutFrontmatter(body) {
  return String(body || "").replace(/^---\n[\s\S]*?\n---\n/, "");
}

export function cleanWikiLinkLabel(link) {
  return String(link || "")
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]
    .replace(/\.md$/, "")
    .trim();
}

export function localReadableSourceText(text) {
  return String(text || "")
    .replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, "")
    .replace(/^(?:title|description|summary|source|url|author|published|created|tags):[\s\S]*?\n---\s*(?:\n|$)/i, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "");
}

export function cleanExtractedSourceText(text) {
  return cleanSummary(String(text || "")
    .replace(/\bPage\s+\d+\b/gi, " ")
    .replace(/\bDEMO\b/gi, " demo ")
    .replace(/\s*[|•]\s*/g, " ")
    .replace(/\b(?:Member SIPC|Not an actual account statement|Sample client data)\b/gi, (match) => ` ${match}. `));
}

export function firstMatch(text, pattern) {
  const match = String(text || "").match(pattern);
  return match?.[1] ? cleanSummary(match[1]) : match?.[0] ? cleanSummary(match[0]) : "";
}

// ---------------------------------------------------------------------
// Frontmatter helpers (read + write)
// ---------------------------------------------------------------------

export function cleanYamlScalar(value) {
  return cleanSummary(String(value || "")
    .replace(/^[>|]\s*/, "")
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\(["'])/g, "$1"));
}

export function frontmatterList(value) {
  if (Array.isArray(value)) return value.map((item) => yamlScalar(item)).filter(Boolean);
  const raw = String(value || "").trim();
  if (!raw) return [];
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw
      .slice(1, -1)
      .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
      .map((item) => yamlScalar(item))
      .filter(Boolean);
  }
  return raw.split(",").map((item) => yamlScalar(item)).filter(Boolean);
}

export function insertFrontmatterLine(body, line) {
  if (/^---\n/.test(body)) return body.replace(/^---\n/, `---\n${line}\n`);
  return `---\n${line}\n---\n\n${body}`;
}

export function upsertFrontmatterScalar(body, key, value) {
  const cleanValue = String(value || "").trim();
  if (!cleanValue) return body;
  const line = `${key}: ${cleanValue}`;
  if (new RegExp(`^${escapeRegExp(key)}:\\s*.*$`, "m").test(body)) {
    return body.replace(new RegExp(`^${escapeRegExp(key)}:\\s*.*$`, "m"), line);
  }
  return insertFrontmatterLine(body, line);
}

export function upsertFrontmatterList(body, key, values) {
  const cleanValues = uniqueBy(values.map(cleanTag).filter(Boolean), (tag) => tag);
  if (cleanValues.length === 0) return body;
  const line = `${key}: [${cleanValues.join(", ")}]`;
  if (new RegExp(`^${escapeRegExp(key)}:\\s*\\[[^\\n]*\\]\\s*$`, "m").test(body)) {
    return body.replace(new RegExp(`^${escapeRegExp(key)}:\\s*\\[[^\\n]*\\]\\s*$`, "m"), line);
  }
  if (new RegExp(`^${escapeRegExp(key)}:\\s*$`, "m").test(body)) {
    return body.replace(new RegExp(`^${escapeRegExp(key)}:\\s*\\n(?:\\s*-\\s*.*\\n?)*`, "m"), `${line}\n`);
  }
  return insertFrontmatterLine(body, line);
}

export function replaceYamlSummary(body, summary) {
  const line = `summary: ${JSON.stringify(cleanSummary(summary))}`;
  return body.replace(/^summary:\s*.*$/m, line);
}

export function replaceSummarySection(body, summary) {
  const section = `## Summary\n\n${cleanSummary(summary)}`;
  if (/## Summary\s+[\s\S]*?(?=\n##\s|$)/.test(body)) {
    return body.replace(/## Summary\s+[\s\S]*?(?=\n##\s|$)/, section);
  }
  return `${body.trim()}\n\n${section}\n`;
}

export function replaceSourceHeading(body, title) {
  const heading = `# Source: ${cleanSummary(title)}`;
  if (/^# Source:\s*.*$/m.test(body)) return body.replace(/^# Source:\s*.*$/m, heading);
  if (/^#\s+.*$/m.test(body)) return body.replace(/^#\s+.*$/m, heading);
  return `${heading}\n\n${body}`;
}

// ---------------------------------------------------------------------
// Path normalization (wiki bucket resolution)
// ---------------------------------------------------------------------

export const WIKI_SOURCE_BUCKETS = new Set(["sources", "coding", "ideas", "projects", "career", "personal", "school"]);

export function cleanBucket(value) {
  const bucket = cleanTag(value).replace(/^wiki\//, "").split("/")[0];
  return WIKI_SOURCE_BUCKETS.has(bucket) ? bucket : "";
}

export function sourceSlugForFile(name) {
  const slug = slugifyLoose(basename(name || "source").replace(/\.[^.]+$/, ""));
  return slug.startsWith("source-") ? slug : `source-${slug || "source"}`;
}

export function sourcePathForBucket(name, bucket = "sources") {
  const clean = cleanBucket(bucket) || "sources";
  return `wiki/${clean}/${sourceSlugForFile(name)}.md`;
}

export function normalizeMarginsPath(path) {
  return String(path).replace(/^\.margins\//, "wiki/.margins/");
}

export function normalizeFilingPath(path, bucket = "sources") {
  const raw = String(path || "").trim();
  if (!raw) return "";
  let normalized = normalizeMarginsPath(raw).replace(/^\/+/, "");
  if (!normalized.startsWith("wiki/")) normalized = `wiki/${normalized}`;
  if (!normalized.endsWith(".md")) normalized = `${normalized}.md`;
  const folder = normalized.split("/")[1] || "";
  if (!WIKI_SOURCE_BUCKETS.has(folder)) {
    normalized = sourcePathForBucket(basename(normalized).replace(/\.md$/, ""), bucket);
  }
  const filename = basename(normalized);
  if (!filename.startsWith("source-")) {
    normalized = normalized.replace(/\/[^/]+\.md$/, `/${sourceSlugForFile(filename)}.md`);
  }
  return normalizeMarginsPath(normalized);
}

export function isReadableSourceTextPath(path) {
  return /\.(md|markdown|txt|json|jsonl|csv|tsv|py|js|jsx|ts|tsx|html|css|xml|yaml|yml|log|eml|ics|ical|vtt|srt)$/i.test(path);
}

// ---------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------

export function warningLabel(warnings) {
  return warnings.length ? ` · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : "";
}
