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

import { excerptForQuestion } from "./utils.js";

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

export function isFolderIndexPath(path) {
  const parts = path.split("/");
  if (parts.length !== 3) return false;
  return parts[2].replace(/\.md$/, "") === parts[1];
}

export function isPinnedFrontmatterValue(value) {
  return /^(true|yes|1|pinned)$/i.test(String(value || "").trim());
}

export function isContextWikiPagePath(path) {
  return path.startsWith("wiki/") &&
    path.endsWith(".md") &&
    !path.startsWith("wiki/.margins/") &&
    !path.startsWith("wiki/_templates/");
}

export function graphTypeFromPath(path, body = "") {
  const fields = frontmatterFields(body);
  const frontmatterType = normalizeEntityTag(fields.type || fields.primary_type || "");
  if (frontmatterType === "source") return "source";
  if (frontmatterType === "concept") return "concept";
  if (frontmatterType === "entity" || frontmatterType === "person" || frontmatterType === "company") return "entity";
  if (frontmatterType === "project") return "project";
  if (frontmatterType === "synthesis") return "synthesis";
  if (path.startsWith("wiki/sources/")) return "source";
  if (path.startsWith("wiki/concepts/")) return "concept";
  if (path.startsWith("wiki/entities/")) return "entity";
  if (path.startsWith("wiki/projects/")) return "project";
  if (path.startsWith("wiki/synthesis/")) return "synthesis";
  return "index";
}

export const GENERIC_CHECKLIST_LINKS = new Set([
  "abstract",
  "analysis",
  "actually",
  "condition",
  "conditions",
  "conclusion",
  "data",
  "display",
  "displays",
  "discussion",
  "experiment",
  "experiments",
  "figure",
  "figures",
  "going",
  "introduction",
  "know",
  "method",
  "methods",
  "paper",
  "participant",
  "participants",
  "procedure",
  "reference",
  "references",
  "result",
  "results",
  "section",
  "study",
  "subjects",
  "table",
  "thats",
  "that-s",
  "thing",
  "things",
  "think",
  "task",
  "tasks",
  "really",
  "yeah"
]);

export function isGenericChecklistLink(link) {
  const slug = slugifyLoose(cleanWikiLinkLabel(link));
  return slug.length < 3 || GENERIC_CHECKLIST_LINKS.has(slug);
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

export function yamlInlineScalar(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9_/-]+$/.test(text) ? text : JSON.stringify(text);
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

export function extractInlineTags(body) {
  const text = bodyWithoutFrontmatter(body)
    .replace(/```[\s\S]*?```/g, " ")
    .split("\n")
    .filter((line) => !/^#{1,6}\s/.test(line.trim()))
    .join("\n");
  const tags = [];
  const pattern = /(^|[\s([{])#([A-Za-z0-9][A-Za-z0-9/_-]{0,64})\b/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    tags.push(match[2]);
  }
  return tags;
}

export function uniqueEntityTags(tags) {
  return [...new Set(tags.map(normalizeEntityTag).filter(Boolean))];
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

export function extractWikiLinks(body) {
  const links = [];
  const pattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let match;
  while ((match = pattern.exec(String(body || ""))) !== null) {
    links.push(match[1].trim());
  }
  return links;
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

export function stripTrailingEllipsis(value) {
  return String(value || "").replace(/\s*(?:\.{3}|…)\s*$/u, "").trim();
}

export function clampSentence(value, limit) {
  const text = cleanSummary(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 3).trim()}...`;
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
// Entity-frontmatter mutators (used by pin / type / promotion flows)
// ---------------------------------------------------------------------

export function normalizePrimaryTypeValue(value) {
  return slugifyLoose(cleanSummary(value));
}

export function extractSourceSummary(body) {
  if (!body) return "";
  const section = body.match(/## Summary\s+([\s\S]*?)(?:\n##\s|$)/);
  if (section?.[1]) return cleanSummary(section[1]);
  const yaml = body.match(/^summary:\s*("?)(.*?)\1\s*$/m);
  return yaml?.[2] ? cleanSummary(yaml[2]) : "";
}

export function setFrontmatterScalarField(body, key, value) {
  const source = String(body || "");
  const cleanKey = String(key || "").trim();
  const cleanValue = String(value || "").trim();
  if (!cleanKey || !cleanValue) return source;
  const line = `${cleanKey}: ${yamlInlineScalar(cleanValue)}`;
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return `---\n${line}\n---\n\n${source}`;

  const lines = match[1].split("\n");
  const keyPattern = new RegExp(`^${escapeRegExp(cleanKey)}:\\s*`, "i");
  let replaced = false;
  const nextLines = lines.map((item) => {
    if (keyPattern.test(item)) {
      replaced = true;
      return line;
    }
    return item;
  });
  if (!replaced) {
    const typeIndex = nextLines.findIndex((item) => /^type:\s*/i.test(item));
    nextLines.splice(typeIndex >= 0 ? typeIndex + 1 : nextLines.length, 0, line);
  }
  return `---\n${nextLines.join("\n")}${nextLines.length && !nextLines[nextLines.length - 1].endsWith("\n") ? "\n" : ""}---\n${source.slice(match[0].length)}`;
}

export function setEntityPrimaryTypeBody(body, primaryType) {
  return setFrontmatterScalarField(body, "primary_type", normalizePrimaryTypeValue(primaryType));
}

export function setPinnedFrontmatterField(frontmatter) {
  const lines = frontmatter.split("\n");
  let foundPriority = false;
  const nextLines = lines
    .filter((line) => !/^pinned:\s*/i.test(line))
    .map((line) => {
      if (/^priority:\s*/i.test(line)) {
        foundPriority = true;
        return "priority: pinned";
      }
      return line;
    });
  if (!foundPriority) nextLines.push("priority: pinned");
  return nextLines.join("\n");
}

export function removePinnedFrontmatterSignals(frontmatter) {
  const lines = frontmatter.split("\n");
  const nextLines = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) {
      nextLines.push(line);
      continue;
    }

    const key = field[1].toLowerCase();
    const value = yamlScalar(field[2]).toLowerCase();
    if ((key === "priority" || key === "status") && value === "pinned") continue;
    if (key === "pinned") continue;
    if (key === "tags") {
      if (field[2].trim()) {
        const tags = frontmatterList(field[2]).filter((tag) => normalizeEntityTag(tag) !== "pinned");
        if (tags.length) nextLines.push(`tags: [${tags.map(yamlInlineScalar).join(", ")}]`);
        continue;
      }

      const listItems = [];
      let cursor = index + 1;
      while (cursor < lines.length && /^\s*-\s*/.test(lines[cursor])) {
        const tag = yamlScalar(lines[cursor].replace(/^\s*-\s*/, ""));
        if (normalizeEntityTag(tag) !== "pinned") listItems.push(lines[cursor]);
        cursor += 1;
      }
      if (listItems.length) {
        nextLines.push(line);
        nextLines.push(...listItems);
      }
      index = cursor - 1;
      continue;
    }

    nextLines.push(line);
  }
  return nextLines.join("\n");
}

// ---------------------------------------------------------------------
// Wiki-context record (used by ingest prompt builder + entity view)
// ---------------------------------------------------------------------

export function contextSnippet(body) {
  const clean = bodyWithoutFrontmatter(body)
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("# ") && !/^(?:Raw|Original) file:/i.test(trimmed);
    })
    .slice(0, 18)
    .join(" ");
  return excerptForQuestion(clean, 360);
}

export function wikiContextRecord(path, body) {
  const frontmatter = frontmatterFields(body);
  const title = markdownTitle(body) || titleFromSlug(basename(path).replace(/\.md$/, ""));
  const summary = cleanSummary(frontmatter.summary || extractSourceSummary(body) || excerptForQuestion(bodyWithoutFrontmatter(body), 260));
  const tags = frontmatterList(frontmatter.tags);
  const keyLinks = [
    ...frontmatterList(frontmatter.key_links),
    ...extractWikiLinks(body)
  ].map((link) => cleanWikiLinkLabel(link)).filter(Boolean);
  return {
    path,
    body,
    title,
    summary,
    type: frontmatter.type || graphTypeFromPath(path),
    bucket: frontmatter.bucket || path.split("/")[1] || "wiki",
    status: frontmatter.status || "",
    priority: frontmatter.priority || "",
    updated: frontmatter.updated || frontmatter.created || "",
    tags,
    keyLinks: [...new Set(keyLinks)].slice(0, 12),
    snippet: contextSnippet(body)
  };
}

export function wikiContextRecords(fileMap) {
  return [...fileMap.entries()]
    .filter(([path]) => isContextWikiPagePath(path))
    .map(([path, body]) => wikiContextRecord(path, body));
}

export function entityPinnedBody(body, shouldPin) {
  const source = String(body || "");
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return shouldPin ? `---\npriority: pinned\n---\n\n${source}` : source;
  }

  const frontmatter = shouldPin
    ? setPinnedFrontmatterField(match[1])
    : removePinnedFrontmatterSignals(match[1]);
  return `---\n${frontmatter}${frontmatter.endsWith("\n") ? "" : "\n"}---\n${source.slice(match[0].length)}`;
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
// Loose-shape value coercion (used by API review parsers + format-section)
// ---------------------------------------------------------------------

export function arrayFromUnknown(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

export function cleanDisplaySummary(value) {
  return cleanSummary(String(value || "")
    .replace(/\b[A-Z0-9._%+-]+@\s*[A-Z0-9.-]+(?:\s*\.\s*[A-Z]{2,})+\b/gi, " ")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, " ")
    .replace(/\b[A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+){0,3}\s+(?:Department|School|Faculty|Institute)\s+of\s+[^.!?]{0,180}/g, " ")
    .replace(/\b(?:Department|School|Faculty|Institute)\s+of\s+[^.!?]{0,160}/gi, " ")
    .replace(/\s{2,}/g, " "));
}

export function summaryTextValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return cleanDisplaySummary(value);
  }
  if (Array.isArray(value)) {
    return cleanDisplaySummary(value.map(summaryTextValue).filter(Boolean).join(" "));
  }
  if (typeof value === "object") {
    const candidate = ["point", "takeaway", "text", "summary", "overview", "oneLine", "one_line", "note", "reason", "title", "description"]
      .map((key) => value[key])
      .find((item) => item !== undefined && item !== null);
    return cleanDisplaySummary(candidate ?? "");
  }
  return "";
}

export function stringListFromUnknown(value) {
  return arrayFromUnknown(value)
    .flatMap((item) => Array.isArray(item) ? item : [item])
    .map(summaryTextValue)
    .filter(Boolean);
}

export function tagListFromUnknown(value) {
  return stringListFromUnknown(value)
    .flatMap((item) => item.split(/[,|]/))
    .map(cleanTag)
    .filter(Boolean);
}

export function relevanceValue(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "secondary" || normalized === "context") return normalized;
  return "primary";
}

export function confidenceValue(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") return normalized;
  return "medium";
}

// ---------------------------------------------------------------------
// Filing-plan + financial-details predicates
// ---------------------------------------------------------------------

export function hasFilingPlan(plan) {
  return Boolean(plan && (
    plan.whySaved?.length ||
    plan.candidateFiles?.length ||
    plan.tags?.length ||
    plan.regionTag ||
    plan.typeTag ||
    plan.typeTagNote ||
    plan.placement?.path ||
    plan.placement?.bucket ||
    plan.placement?.title ||
    plan.placement?.reason ||
    plan.promotion?.candidate ||
    plan.promotion?.recommendation
  ));
}

export function hasFinancialDetails(details) {
  return Boolean(details && (
    details.accounts?.length ||
    details.figures?.length ||
    details.holdings?.length ||
    details.transactions?.length ||
    details.caveats?.length
  ));
}

export function sourceTagsFromFilingPlan(plan) {
  return uniqueBy([
    "source",
    ...tagListFromUnknown(plan.tags),
    plan.regionTag,
    plan.typeTag
  ].map(cleanTag).filter(Boolean), (tag) => tag);
}

// ---------------------------------------------------------------------
// Section-format helpers (markdown body section writers)
// ---------------------------------------------------------------------

export function formatFilingJudgmentMarkdown(plan) {
  const lines = ["## Filing Judgment", ""];
  const placement = plan.placement || {};
  if (placement.path || placement.bucket || placement.reason) {
    lines.push(`- Placement: ${[placement.path, placement.bucket ? `bucket ${placement.bucket}` : "", placement.reason].filter(Boolean).join(" — ")}`);
  }
  if (plan.tags?.length || plan.regionTag || plan.typeTag || plan.typeTagNote) {
    lines.push(`- Tags: ${sourceTagsFromFilingPlan(plan).join(", ") || "source"}`);
    if (plan.typeTagNote) lines.push(`- Type tag note: ${plan.typeTagNote}`);
  }
  if (plan.whySaved?.length) {
    lines.push("", "### Why this belongs");
    lines.push(...plan.whySaved.map((item) => `- ${item}`));
  }
  if (plan.candidateFiles?.length) {
    lines.push("", "### Files checked");
    lines.push(...plan.candidateFiles.map((item) => `- ${item.path}${item.reason ? ` — ${item.reason}` : ""}`));
  }
  if (plan.promotion?.candidate || plan.promotion?.recommendation) {
    lines.push("", "### Promotion");
    lines.push(`- ${[plan.promotion.candidate, plan.promotion.recommendation, plan.promotion.reason].filter(Boolean).join(" — ")}`);
  }
  return lines.join("\n");
}

export function upsertFilingJudgmentSection(body, plan) {
  const section = formatFilingJudgmentMarkdown(plan);
  if (!section) return body;
  if (/## Filing Judgment\s+[\s\S]*?(?=\n##\s|$)/.test(body)) {
    return body.replace(/## Filing Judgment\s+[\s\S]*?(?=\n##\s|$)/, section);
  }
  return `${body.trim()}\n\n${section}\n`;
}

export function formatConnectionLine(connection) {
  const title = connection.title || titleFromSlug(basename(connection.path || "connection").replace(/\.md$/, ""));
  const link = connection.path && connection.path.startsWith("wiki/")
    ? `[[${basename(connection.path).replace(/\.md$/, "")}|${title}]]`
    : title;
  const label = connection.type === "new" ? "new page" : "existing";
  return `- ${link} (${label}) — ${connection.reason || "Relevant to this source."}`;
}

export function upsertConnectionsSection(body, connections) {
  const section = `## Connections\n\n${connections.map(formatConnectionLine).join("\n")}`;
  if (/## Connections\s+[\s\S]*?(?=\n##\s|$)/.test(body)) {
    return body.replace(/## Connections\s+[\s\S]*?(?=\n##\s|$)/, section);
  }
  return `${body.trim()}\n\n${section}\n`;
}

export function financialAccountLine(account) {
  return [
    account.institution,
    account.accountType,
    account.owner ? `owner: ${account.owner}` : "",
    account.accountNumberLast4 ? `last4: ${account.accountNumberLast4}` : "",
    account.period
  ].filter(Boolean).join(" · ");
}

export function financialHoldingLine(holding) {
  return [
    holding.symbol,
    holding.name,
    holding.quantity,
    holding.value,
    holding.context
  ].filter(Boolean).join(" · ");
}

export function financialTransactionLine(transaction) {
  return [
    transaction.date,
    transaction.type && transaction.type !== "unknown" ? transaction.type : "",
    transaction.description,
    transaction.amount
  ].filter(Boolean).join(" · ");
}

export function formatFinancialDetailsMarkdown(details) {
  const lines = [];
  if (details.accounts?.length) {
    lines.push("### Accounts");
    lines.push(...details.accounts.map((account) => `- ${financialAccountLine(account)}`));
    lines.push("");
  }
  if (details.figures?.length) {
    lines.push("### Important Figures");
    lines.push(...details.figures.map((figure) => `- ${[figure.label || "Figure", figure.value, figure.date, figure.context].filter(Boolean).join(" — ")}`));
    lines.push("");
  }
  if (details.holdings?.length) {
    lines.push("### Holdings");
    lines.push(...details.holdings.map((holding) => `- ${financialHoldingLine(holding)}`));
    lines.push("");
  }
  if (details.transactions?.length) {
    lines.push("### Transactions");
    lines.push(...details.transactions.map((transaction) => `- ${financialTransactionLine(transaction)}`));
    lines.push("");
  }
  if (details.caveats?.length) {
    lines.push("### Caveats");
    lines.push(...details.caveats.map((caveat) => `- ${caveat}`));
  }
  return lines.join("\n").trim() || "- No structured financial details extracted.";
}

export function upsertFinancialDetailsSection(body, details) {
  const section = `## Financial Details\n\n${formatFinancialDetailsMarkdown(details)}`;
  if (/## Financial Details\s+[\s\S]*?(?=\n##\s|$)/.test(body)) {
    return body.replace(/## Financial Details\s+[\s\S]*?(?=\n##\s|$)/, section);
  }
  return `${body.trim()}\n\n${section}\n`;
}

// ---------------------------------------------------------------------
// Summary card splitting (overview + bullets from a single blob)
// ---------------------------------------------------------------------

export function chunkLongSummary(summary, maxLength) {
  const clean = cleanSummary(summary);
  if (clean.length <= maxLength) return [clean];
  const words = clean.split(/\s+/);
  const chunks = [];
  let current = "";
  for (const word of words) {
    if (`${current} ${word}`.trim().length > maxLength && current) {
      chunks.push(current.trim());
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

export function summaryLabelSections(summary) {
  const clean = cleanSummary(summary);
  if (clean.length < 260) return clean ? [clean] : [];
  return clean
    .replace(/\s+(Date|Participants|Background|Opportunity|Assessment|Current status|Next steps|Risks|Decision|Follow-up|Context|Transcript)\b/g, "\n$1")
    .split(/\n+/)
    .map((part) => cleanSummary(part))
    .filter(Boolean)
    .slice(0, 8);
}

export function summarySentences(summary) {
  const clean = cleanSummary(summary);
  const matches = clean.match(/[^.!?]+[.!?]+(?:\s|$)/g);
  if (!matches || matches.length < 2) {
    const sections = summaryLabelSections(clean);
    return sections.length > 1 ? sections : clean ? [clean] : [];
  }
  const consumed = matches.join("").trim();
  const tail = clean.slice(consumed.length).trim();
  return [...matches.map((part) => part.trim()), ...(tail ? [tail] : [])].filter(Boolean);
}

export function splitSummaryForCard(summary) {
  const clean = cleanDisplaySummary(summary);
  if (!clean) return [];
  const markdownParts = clean
    .split(/\s+(?:[-*]|\d+[.)])\s+/)
    .map((part) => cleanSummary(part))
    .filter(Boolean);
  if (markdownParts.length > 2) return markdownParts;
  const labeledParts = summaryLabelSections(clean);
  if (labeledParts.length > 2) return labeledParts;
  const sentenceParts = summarySentences(clean);
  if (sentenceParts.length > 2) return sentenceParts;
  return chunkLongSummary(clean, 180).slice(0, 6);
}

export function summaryFallbackParts(summary) {
  const parts = splitSummaryForCard(summary);
  return {
    overview: parts[0] ? clampSentence(parts[0], 220) : "",
    bullets: parts.slice(1, 6).map((part) => clampSentence(part, 220)).filter(Boolean)
  };
}

// ---------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------

export function warningLabel(warnings) {
  return warnings.length ? ` · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : "";
}
