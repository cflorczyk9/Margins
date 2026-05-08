// Entities domain — pure logic.
//
// Phase 9D of the module-split refactor. Pulls record construction,
// predicates, sort, faceting, and label helpers out of app.js. Anything
// here is DOM-free and side-effect-free, so tests can import directly
// without a JSDOM shim.
//
// The matching DOM render + handlers live in views/entities.js.
//
// Cross-module deps:
//   - basename, bodyWithoutFrontmatter, clampSentence, cleanSummary,
//     extractInlineTags, frontmatterFields, isBucketOverviewPath,
//     isFolderIndexPath, isPinnedFrontmatterValue, normalizeEntityTag,
//     normalizePrimaryTypeValue, titleFromSlug, uniqueEntityTags,
//     wikiContextRecord  → core/wiki.js
//   - excerptForQuestion → core/utils.js
//
// Several exports are referenced from app.js outside the entity view —
// keep them stable: entityRecordsFromFileMap, entityRecord,
// isEntityPagePath, entityHasPinnedSignal.

import {
  basename,
  bodyWithoutFrontmatter,
  clampSentence,
  cleanSummary,
  extractInlineTags,
  frontmatterFields,
  isBucketOverviewPath,
  isFolderIndexPath,
  isPinnedFrontmatterValue,
  normalizeEntityTag,
  normalizePrimaryTypeValue,
  titleFromSlug,
  uniqueEntityTags,
  wikiContextRecord
} from "./wiki.js";
import { excerptForQuestion } from "./utils.js";

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

export const ENTITY_RECENT_PAGE_SIZE = 12;
export const CANONICAL_ENTITY_TYPES = ["person", "company", "project", "concept", "synthesis"];

// ---------------------------------------------------------------------
// Pinned signal + recency predicates
// ---------------------------------------------------------------------

export function entityHasPinnedSignal(record) {
  return Boolean(record.pinnedFlag) || record.priority === "pinned" || record.status === "pinned" || record.tags.includes("pinned");
}

export function isEntityActiveThisWeek(updated) {
  const timestamp = Date.parse(updated || "");
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= 7 * 24 * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------
// File-map → records
// ---------------------------------------------------------------------

export function entityRecordsFromFileMap(fileMap) {
  return [...fileMap.entries()]
    .filter(([path, body]) => isEntityPagePath(path, body))
    .map(([path, body]) => entityRecord(path, body))
    .filter(Boolean)
    .sort(entityRecordSort);
}

export function isEntityPagePath(path, body) {
  if (!path.startsWith("wiki/") || !path.endsWith(".md")) return false;
  if (path.startsWith("wiki/.margins/") || path.startsWith("wiki/_templates/")) return false;
  if (isBucketOverviewPath(path)) return false;
  if (isFolderIndexPath(path)) return false;
  if (path === "wiki/index.md" || /^wiki\/(ingest-tracker|log|wiki-stats)\.md$/.test(path)) return false;
  if (path.startsWith("wiki/sources/")) return false;
  if (/^wiki\/[^/]+\/source[-/]/.test(path)) return false;

  const fields = frontmatterFields(body);
  const type = String(fields.type || fields.kind || "").toLowerCase();
  if (["source", "log", "index", "template"].includes(type)) return false;
  if (["entity", "person", "company", "project", "concept", "school", "advisor", "family", "synthesis", "idea"].includes(type)) return true;
  return /^wiki\/(concepts|entities|synthesis|personal|projects|career|ideas|school|coding)\//.test(path);
}

export function entityRecord(path, body) {
  const context = wikiContextRecord(path, body);
  const fields = frontmatterFields(body);
  const title = cleanSummary(context.title || titleFromSlug(basename(path).replace(/\.md$/, "")));
  if (!title || /^(entities|projects|ideas|career|school|personal)$/i.test(title)) return null;
  const filterTags = uniqueEntityTags([
    ...context.tags,
    ...extractInlineTags(body)
  ]);
  const typeLabel = entityTypeLabel(context.type, path, fields, filterTags, context.bucket);
  const summary = cleanSummary(entityField(fields, "card_summary", "one_line", "one_liner") || context.summary || excerptForQuestion(bodyWithoutFrontmatter(body), 180));
  const lastTouch = entityField(fields, "last_contact", "last_touch", "updated", "created") || context.updated || "";
  const tags = [...new Set([
    ...filterTags,
    context.bucket,
    context.status,
    context.priority
  ].filter(Boolean).map(normalizeEntityTag).filter(Boolean))];
  return {
    path,
    title,
    summary: clampSentence(summary, 180),
    typeLabel,
    bucketLabel: entityBucketLabel(path, context.bucket),
    updated: context.updated || "",
    lastTouch,
    meta: entityMetaLine(fields, context, filterTags, lastTouch),
    nextAction: entityNextAction(fields, body),
    pinnedFlag: isPinnedFrontmatterValue(fields.pinned),
    status: normalizeEntityTag(context.status),
    priority: normalizeEntityTag(context.priority),
    tags,
    filterTags,
    connectionCount: context.keyLinks.length
  };
}

// ---------------------------------------------------------------------
// Field accessors + meta line composition
// ---------------------------------------------------------------------

export function entityField(fields, ...names) {
  for (const name of names) {
    const value = fields?.[name];
    if (Array.isArray(value)) {
      const joined = value.map((item) => cleanSummary(item)).filter(Boolean).join(", ");
      if (joined) return joined;
    } else if (String(value || "").trim()) {
      return cleanSummary(value);
    }
  }
  return "";
}

export function entityMetaLine(fields, context, tags, lastTouch) {
  const descriptors = [];
  const role = shortEntityDescriptor(entityField(fields, "role", "job", "position"));
  const firm = shortEntityDescriptor(entityField(fields, "firm", "company", "organization", "org"));
  const category = shortEntityDescriptor(entityField(fields, "category"));
  const relationship = shortEntityDescriptor(entityField(fields, "relationship"));
  const status = shortEntityDescriptor(firstStatusPart(entityField(fields, "status")));

  if (role && firm && !/independent advisor/i.test(firm)) descriptors.push(`${role} at ${firm}`);
  else if (role) descriptors.push(role);
  else if (firm) descriptors.push(firm);

  for (const descriptor of [category, relationship, status, entityTagDescriptor(tags, context.bucket)]) {
    if (!descriptor || descriptors.some((item) => item.toLowerCase() === descriptor.toLowerCase())) continue;
    descriptors.push(descriptor);
    if (descriptors.length >= 2) break;
  }

  const touch = lastTouchPhrase(lastTouch);
  if (touch) descriptors.push(touch);
  return descriptors.slice(0, touch ? 3 : 2).join(" · ");
}

function shortEntityDescriptor(value) {
  return cleanSummary(value)
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstStatusPart(value) {
  return String(value || "").split(",")[0].trim();
}

function entityTagDescriptor(tags, bucket) {
  const stop = new Set([
    "active",
    "advisor",
    "aged",
    "briefly",
    "company",
    "concept",
    "contact",
    "entity",
    "fresh",
    "old",
    "peak",
    "person",
    "pinned",
    "project",
    "recent",
    "source",
    "vibrance/aged",
    "vibrance/fresh",
    "vibrance/old",
    "vibrance/peak",
    "vibrance/recent"
  ]);
  const tag = tags.find((item) => {
    const normalized = normalizeEntityTag(item);
    return normalized && !stop.has(normalized) && !normalized.startsWith("region/") && !normalized.startsWith("vibrance/");
  });
  if (tag) return titleFromSlug(tag.replace(/\//g, "-"));
  return titleFromSlug(bucket || "wiki");
}

function lastTouchPhrase(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return "";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const then = new Date(timestamp);
  const thenDay = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  const days = Math.round((today - thenDay) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "last touch today";
  if (days === 1) return "last touch yesterday";
  if (days < 14) return `last touch ${days}d ago`;
  if (days < 60) return `last touch ${Math.round(days / 7)}w ago`;
  return `last touch ${then.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export function entityNextAction(fields, body) {
  const direct = entityField(fields, "next_move", "next", "follow_up", "action", "todo");
  if (direct) return clampSentence(direct, 96);
  const section = bodyWithoutFrontmatter(body).match(/^##\s+(?:Next|Next move|Follow[- ]?up|Action)\b[^\n]*\n([\s\S]*?)(?=\n##\s|$)/im);
  if (!section?.[1]) return "";
  const line = section[1]
    .split("\n")
    .map((item) => item.replace(/^[-*]\s*/, "").trim())
    .find(Boolean);
  return clampSentence(line || "", 96);
}

// ---------------------------------------------------------------------
// Sort + label helpers
// ---------------------------------------------------------------------

export function entityRecordSort(left, right) {
  const leftDate = Date.parse(left.updated || "");
  const rightDate = Date.parse(right.updated || "");
  if (Number.isFinite(leftDate) || Number.isFinite(rightDate)) {
    return (Number.isFinite(rightDate) ? rightDate : 0) - (Number.isFinite(leftDate) ? leftDate : 0);
  }
  return left.title.localeCompare(right.title);
}

export function entityTypeLabel(type, path, fields = {}, tags = [], bucket = "") {
  const primaryType = normalizePrimaryTypeValue(entityField(fields, "primary_type", "primaryType"));
  if (primaryType) return entityTypeDisplayLabel(primaryType);
  const normalized = String(type || "").toLowerCase();
  const tagSet = new Set(tags.map(normalizeEntityTag));
  const category = normalizeEntityTag(entityField(fields, "category"));
  const role = normalizeEntityTag(entityField(fields, "role"));
  const folder = normalizeEntityTag(bucket || path.split("/")[1] || "");
  if (normalized === "entity") {
    if (tagSet.has("advisor") || category === "coach" || /advisor|coach/.test(role)) return "Advisor";
    if (tagSet.has("person") || tagSet.has("contact") || path.startsWith("wiki/personal/")) return "Person";
    if (tagSet.has("company") || tagSet.has("firm") || tagSet.has("family-office") || tagSet.has("wealth-management")) return "Company";
    if (tagSet.has("project") || tagSet.has("startup") || folder === "projects") return "Project";
    if (tagSet.has("concept") || folder === "concepts" || folder === "ideas") return "Concept";
    return "Entity";
  }
  if (normalized === "person") return "Person";
  if (normalized === "company") return "Company";
  if (normalized === "project") return "Project";
  if (normalized === "concept") return "Concept";
  if (normalized === "advisor") return "Advisor";
  if (normalized === "school") return "School";
  if (path.startsWith("wiki/personal/")) return "Person";
  if (path.startsWith("wiki/projects/")) return "Project";
  if (path.startsWith("wiki/ideas/")) return "Idea";
  if (path.startsWith("wiki/career/")) return "Career";
  if (path.startsWith("wiki/school/")) return "School";
  return titleFromSlug(normalized || "entity");
}

export function entityTypeDisplayLabel(value) {
  const normalized = normalizePrimaryTypeValue(value);
  return normalized ? titleFromSlug(normalized) : "Entity";
}

export function entityBucketLabel(path, bucket) {
  const folder = path.split("/")[1] || bucket || "wiki";
  return titleFromSlug(bucket || folder);
}

export function entityVibeClass(record) {
  for (const vibe of ["peak", "fresh", "recent", "aged", "old"]) {
    if (record.filterTags.includes(`vibrance/${vibe}`) || record.filterTags.includes(vibe)) return vibe;
  }
  const timestamp = Date.parse(record.lastTouch || record.updated || "");
  if (Number.isFinite(timestamp)) {
    const days = Math.max(0, Math.round((Date.now() - timestamp) / (24 * 60 * 60 * 1000)));
    if (days <= 2) return "peak";
    if (days <= 7) return "fresh";
    if (days <= 30) return "recent";
    if (days <= 90) return "aged";
  }
  return "old";
}

// ---------------------------------------------------------------------
// Faceting + counts
// ---------------------------------------------------------------------

export function entityTypeFacets(records) {
  const counts = countBy(records, (record) => record.typeLabel);
  const typeOrder = ["Person", "Advisor", "Company", "Project", "Concept", "Idea", "School", "Career", "Synthesis", "Entity"];
  const orderedTypes = [...counts.entries()]
    .sort((left, right) => {
      const leftIndex = typeOrder.indexOf(left[0]);
      const rightIndex = typeOrder.indexOf(right[0]);
      const leftRank = leftIndex === -1 ? typeOrder.length : leftIndex;
      const rightRank = rightIndex === -1 ? typeOrder.length : rightIndex;
      return leftRank - rightRank || right[1] - left[1] || left[0].localeCompare(right[0]);
    });
  return [
    { kind: "all", value: "", label: "All", count: records.length },
    ...orderedTypes.map(([label, count]) => ({
      kind: "type",
      value: label,
      label: pluralEntityTypeLabel(label),
      count
    }))
  ];
}

export function entityTagFacets(records) {
  return [...countBy(records.flatMap((record) => record.filterTags), (tag) => tag).entries()]
    .filter(([tag]) => tag)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10)
    .map(([tag, count]) => ({
      kind: "tag",
      value: tag,
      label: tag,
      count
    }));
}

export function entityTypePickerOptions(records = []) {
  const counts = countBy(records, (record) => entityTypeDisplayLabel(record.typeLabel));
  const canonicalLabels = CANONICAL_ENTITY_TYPES.map(entityTypeDisplayLabel);
  const canonicalSet = new Set(canonicalLabels.map((label) => label.toLowerCase()));
  const canonical = CANONICAL_ENTITY_TYPES.map((value, index) => ({
    value,
    label: canonicalLabels[index],
    count: counts.get(canonicalLabels[index]) || 0
  }));
  const extras = [...counts.entries()]
    .filter(([label]) => !canonicalSet.has(String(label).toLowerCase()))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([label, count]) => ({
      value: normalizePrimaryTypeValue(label),
      label,
      count
    }));
  return [...canonical, ...extras];
}

function countBy(items, keyForItem) {
  const counts = new Map();
  items.forEach((item) => {
    const key = keyForItem(item);
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

export function pluralEntityTypeLabel(label) {
  return {
    Person: "People",
    Advisor: "Advisors",
    Company: "Companies",
    Project: "Projects",
    Concept: "Concepts",
    Idea: "Ideas",
    School: "School",
    Career: "Career",
    Synthesis: "Synthesis",
    Entity: "Entities"
  }[label] || `${label}s`;
}
