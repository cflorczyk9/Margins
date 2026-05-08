// Pure stats / report builder helpers for the Dream maintenance view.
//
// Phase 11a — extracted from src/app.js. Functions in this module:
//   - take fileMap (Map<string, string>) or simple plain-data arguments
//   - return new objects/arrays
//   - never read or mutate the runtime `state` singleton
//   - never touch the DOM, network, or async APIs
//
// If a Dream helper needs `state` or DOM access, it stays in app.js.

import {
  basename,
  cleanWikiLinkLabel,
  extractWikiLinks,
  frontmatterFields,
  markdownTitle,
  normalizeEntityTag,
  normalizeMarginsPath,
  slugifyLoose
} from "./wiki.js";
import { clamp, formatStatNumber, wordCount } from "./utils.js";

export const DREAM_LOG_PATH = "wiki/.margins/dream-log.md";

export const DREAM_MODES = {
  watch: {
    label: "Quick scan",
    help: "Only checks the vault and explains what needs attention."
  },
  walk: {
    label: "Deep API review",
    help: "Runs standard cleanup, then calls the API helpers for reviewable fixes."
  },
  hybrid: {
    label: "Standard cleanup",
    help: "Scans existing vault notes, records the pass, and queues review items."
  }
};

export const DREAM_STAGES = [
  {
    id: "replay",
    name: "Vault scan",
    label: "Read existing notes",
    description: "Scans existing wiki pages and source notes for retrieval problems without touching pending uploads."
  },
  {
    id: "pruning",
    name: "Entity cleanup",
    label: "Find weak pages",
    description: "Flags sparse entity pages, stale drafts, and cleanup candidates without deleting anything."
  },
  {
    id: "association",
    name: "Link cleanup",
    label: "Strengthen links",
    description: "Looks for pages that should be reviewed for backlinks, citations, or graph structure."
  },
  {
    id: "synthesis",
    name: "Cross-source review",
    label: "Surface patterns",
    description: "Queues cross-source summary opportunities for review instead of creating them silently."
  },
  {
    id: "clearance",
    name: "System cleanup",
    label: "Repair structure",
    description: "Handles direct-read cleanup such as check logs, unmatched wikilinks, and safe metadata repairs."
  }
];

export const DREAM_PLACEHOLDER_LINKS = new Set([
  "source-slug",
  "page-name",
  "entity-name",
  "concept-name",
  "target-page",
  "target-slug",
  "example",
  "example-page"
]);

// Identify the Dream-bucket type for a wiki page given its path + body.
// Returns "source" | "concept" | "entity" | "synthesis" | "" (unknown).
export function dreamPageType(path, body) {
  const fields = frontmatterFields(body);
  const type = normalizeEntityTag(fields.type || fields.primary_type || "");
  if (type === "source") return "source";
  if (type === "concept") return "concept";
  if (type === "synthesis") return "synthesis";
  if (["entity", "person", "company", "project"].includes(type)) return "entity";
  if (path.startsWith("wiki/concepts/") || path.startsWith("wiki/ideas/")) return "concept";
  if (path.startsWith("wiki/entities/") || path.startsWith("wiki/personal/") || path.startsWith("wiki/projects/")) return "entity";
  if (path.startsWith("wiki/synthesis/") || path.startsWith("wiki/queries/")) return "synthesis";
  return "";
}

// Returns true for wiki pages we want to scan for broken wikilinks.
// Skips internal Margins folders and template scaffolds.
export function isDreamBrokenLinkScanPath(path) {
  return path.startsWith("wiki/") &&
    path.endsWith(".md") &&
    !path.startsWith("wiki/.margins/") &&
    !path.startsWith("wiki/_templates/");
}

// Returns true for wikilinks that look like template placeholders rather
// than real targets ("source-slug", "[[example-page]]", etc.).
export function isDreamPlaceholderLink(target) {
  const slug = slugifyLoose(cleanWikiLinkLabel(target));
  if (!slug) return true;
  if (DREAM_PLACEHOLDER_LINKS.has(slug)) return true;
  if (/^(?:example|sample|template|placeholder)(?:-|$)/.test(slug)) return true;
  if (/^(?:source|page|entity|concept|target)-slug$/.test(slug)) return true;
  return false;
}

// Stable key used to track which broken-link suggestions a user has dismissed.
export function dreamBrokenLinkKey(fromPath, brokenTarget) {
  const from = normalizeMarginsPath(fromPath || "");
  const target = cleanWikiLinkLabel(brokenTarget || "");
  return from && target ? `${from}::${slugifyLoose(target)}` : "";
}

// Normalize a wiki path into the bare slug form used in [[wiki-link]] syntax.
export function wikiLinkTargetForPath(path) {
  return basename(normalizeMarginsPath(path).replace(/\.md$/, ""));
}

// Walk the fileMap and return every wikilink that has no matching wiki page.
// Pure: returns [{ from, to }] without mutating the fileMap.
export function dreamBrokenLinks(fileMap) {
  const byPath = new Set();
  const bySlug = new Set();
  for (const [path, body] of fileMap.entries()) {
    if (!path.endsWith(".md")) continue;
    const normalizedPath = normalizeMarginsPath(path);
    byPath.add(normalizedPath);
    byPath.add(normalizedPath.replace(/\.md$/, ""));
    bySlug.add(slugifyLoose(basename(normalizedPath).replace(/\.md$/, "")));
    const title = markdownTitle(body);
    if (title) bySlug.add(slugifyLoose(title));
  }

  const missing = [];
  for (const [path, body] of fileMap.entries()) {
    if (!isDreamBrokenLinkScanPath(path)) continue;
    for (const target of extractWikiLinks(body)) {
      if (isDreamPlaceholderLink(target)) continue;
      const trimmed = normalizeMarginsPath(target.replace(/^\//, "").replace(/\.md$/, ""));
      const candidates = [
        trimmed,
        `${trimmed}.md`,
        `wiki/${trimmed}`,
        `wiki/${trimmed}.md`,
        `wiki/sources/${trimmed}.md`,
        `wiki/concepts/${trimmed}.md`,
        `wiki/entities/${trimmed}.md`,
        `wiki/projects/${trimmed}.md`,
        `wiki/synthesis/${trimmed}.md`
      ];
      const found = candidates.some((candidate) => byPath.has(normalizeMarginsPath(candidate))) || bySlug.has(slugifyLoose(trimmed));
      if (!found) missing.push({ from: path, to: target });
    }
  }
  return missing;
}

// Count nodes/edges across the wiki portion of the fileMap.
export function dreamGraphStats(fileMap) {
  const wikiPages = [...fileMap.entries()].filter(([path]) => path.startsWith("wiki/") && path.endsWith(".md"));
  const linkCount = wikiPages.reduce((sum, [, body]) => sum + extractWikiLinks(body).length, 0);
  return {
    nodes: wikiPages,
    edges: Array.from({ length: linkCount })
  };
}

// Compact stage status string used by the operations rail.
export function dreamStageMetric(queued, applied, deferred) {
  if (applied) return `${formatStatNumber(applied)} applied`;
  if (deferred) return `${formatStatNumber(deferred)} review`;
  if (queued) return `${formatStatNumber(queued)} queued`;
  return "clear";
}

// Look up the human-readable name for a Dream stage id.
export function dreamStageName(stageId) {
  return DREAM_STAGES.find((stage) => stage.id === stageId)?.name || "maintenance";
}

// Drop the first N broken links into ready-to-render activity entries.
export function dreamUnmatchedLinkEntries(links = []) {
  return links.slice(0, 4).map((link) => ({
    kind: "scan",
    title: "Left wikilink alone",
    file: link.from,
    broken: link.to,
    context: "No confident existing target."
  }));
}

// Heuristic estimate (in ms) for how long a cleanup pass should take given
// scan stats. Used to drive the running-status countdown.
export function dreamCleanupEstimateMs(stats = {}) {
  const brokenLinkCount = Math.max(0, Number(stats.brokenLinkCount) || 0);
  const sparseEntityCount = Math.max(0, Number(stats.sparseEntityCount) || 0);
  const graphNodeCount = Math.max(0, Number(stats.graphNodeCount) || 0);
  const baseMs = 4200 + (graphNodeCount * 28) + (brokenLinkCount * 450) + (sparseEntityCount * 260);
  return clamp(baseMs, 5000, 36000);
}

// Format a millisecond duration into a compact run-time string ("12s", "2m 04s").
export function formatDreamRunDuration(milliseconds) {
  const seconds = Math.max(0, Math.round((Number(milliseconds) || 0) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds
    ? `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`
    : `${minutes}m`;
}

// Diff two fileMaps and return the list of paths that changed, with simple
// added/removed/updated kinds and word counts. Pure — neither map mutated.
export function dreamChangedFilesFromRun(beforeMap, afterMap) {
  const before = beforeMap instanceof Map ? beforeMap : new Map();
  const after = afterMap instanceof Map ? afterMap : new Map();
  const paths = new Set([...before.keys(), ...after.keys()].map(normalizeMarginsPath));
  return [...paths].sort().reduce((changes, path) => {
    const beforeHas = before.has(path);
    const afterHas = after.has(path);
    const beforeBody = beforeHas ? before.get(path) : "";
    const afterBody = afterHas ? after.get(path) : "";
    if (beforeHas === afterHas && beforeBody === afterBody) return changes;
    changes.push({
      path,
      kind: beforeHas ? afterHas ? "updated" : "removed" : "added",
      beforeWords: beforeBody ? wordCount(beforeBody) : 0,
      afterWords: afterBody ? wordCount(afterBody) : 0
    });
    return changes;
  }, []);
}

// Build the queue of repair item proposals derived purely from vault stats.
// Returns an array of plain queue rows that the view layer renders.
export function dreamRepairItems(stats) {
  const items = [];
  items.push({
    id: "pruning-sparse-entities",
    stage: "pruning",
    safety: "review",
    title: stats.sparseEntityCount
      ? `${formatStatNumber(stats.sparseEntityCount)} sparse entity page${stats.sparseEntityCount === 1 ? "" : "s"}`
      : "Improve entity pages",
    body: stats.sparseEntityCount
      ? `${formatStatNumber(stats.sparseEntityCount)} entity page${stats.sparseEntityCount === 1 ? " is" : "s are"} missing a summary or useful supporting context.`
      : "No sparse entity pages found.",
    runBody: "Reviews thin entity pages that may be hurting retrieval.",
    action: "dream-agent",
    actionLabel: "Improve entities",
    target: "pruning-sparse-entities",
    disabled: stats.sparseEntityCount === 0
  });
  items.push({
    id: "association-source-links",
    stage: "association",
    safety: "review",
    title: "Find source-backed backlinks",
    body: stats.sourceCount >= 2
      ? "Recent source notes may support better links to durable pages."
      : "Needs at least two processed source notes.",
    runBody: "Looks for high-value backlinks that need judgment before adding.",
    action: "dream-agent",
    actionLabel: "Propose backlinks",
    target: "association-source-links",
    disabled: stats.sourceCount < 2
  });
  items.push({
    id: "synthesis-cross-source",
    stage: "synthesis",
    safety: "review",
    title: "Look for one cross-source summary",
    body: stats.sourceCount >= 2
      ? "Recent source notes may share a pattern worth summarizing."
      : "Needs at least two processed source notes.",
    runBody: "Looks for one cross-source summary worth creating.",
    action: "dream-agent",
    actionLabel: "Check for summary",
    target: "synthesis-cross-source",
    disabled: stats.sourceCount < 2
  });
  return items;
}

