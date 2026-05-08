// Inbox view — pure helpers (Phase 12a, smallest sub-commit).
//
// This first slice only extracts the truly pure / near-pure leaf
// functions used by the inbox / recent-activity / source-list flows.
// Stateful renderers (renderRecentActivity, processPendingSource,
// renderSources, etc.) stay in app.js for now — they live with their
// dependent helpers (rawSourceCandidatePaths, isActivitySourcePagePath,
// renderSourceActionButton, withBusyOperation, …) until later phases
// (12b/12c) wire them through an init({els, callbacks}) seam.
//
// Everything exported here is a pure function plus `escapeHtml`-bound
// formatter — no DOM access, no state mutation. Safe to call from any
// module (app.js, future views/inbox.js renderers, or tests).

import {
  hasFilingPlan,
  frontmatterFields,
  frontmatterList,
  normalizeMarginsPath,
  replaceSourceHeading,
  sourceTagsFromFilingPlan,
  upsertFilingJudgmentSection,
  upsertFrontmatterList,
  upsertFrontmatterScalar
} from "../core/wiki.js";
import { escapeHtml } from "../core/utils.js";

// ---------------------------------------------------------------------
// Ingest answer keying — used by source-card answer chips and the
// review reply panel. Pure string concat; no state coupling.
// ---------------------------------------------------------------------

export function ingestAnswerKey(fileName, question) {
  return `${fileName}::${question}`;
}

// ---------------------------------------------------------------------
// Source-type predicates — pure file-shape checks.
// ---------------------------------------------------------------------

export function needsTextExtraction(file) {
  return (file.type === "pdf" || file.type === "docx" || file.type === "attachment") && !file.text;
}

export function requiresModelReview(file) {
  // Every uploaded source must go through the LLM. The local heuristic path is
  // not a fallback. Without a model review there is no source.
  return true;
}

// ---------------------------------------------------------------------
// Filing-plan body application — folds the LLM's filing decision into
// the source page's frontmatter + heading. Pure string transform.
// ---------------------------------------------------------------------

export function applyFilingPlanToSourceBody(body, plan) {
  if (!hasFilingPlan(plan)) return body;
  let next = body;
  const placement = plan.placement || {};
  if (placement.bucket) next = upsertFrontmatterScalar(next, "bucket", placement.bucket);
  const tags = sourceTagsFromFilingPlan(plan);
  if (tags.length) next = upsertFrontmatterList(next, "tags", tags);
  if (placement.title) next = replaceSourceHeading(next, placement.title);
  next = upsertFilingJudgmentSection(next, plan);
  return next;
}

// ---------------------------------------------------------------------
// Raw-source body matching — checks whether a wiki body cites a given
// raw/ path either inline or via the `raw_file` frontmatter list.
// ---------------------------------------------------------------------

// bodyReferencesRawSource lives in core/vault.js (vault-domain helper).

// ---------------------------------------------------------------------
// Source timestamp helpers — derive a Date from a File-shaped record's
// lastModified, format it for source-card and activity displays, and
// emit a <time> element when present. Pure (escapeHtml is pure too).
// ---------------------------------------------------------------------

export function sourceTimestampDate(file) {
  const value = Number(file?.lastModified || 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatSourceTimestamp(date) {
  const now = new Date();
  const includeYear = date.getFullYear() !== now.getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function renderSourceTimestamp(file) {
  const date = sourceTimestampDate(file);
  if (!date) return "";
  return `<time class="source-timestamp" datetime="${escapeHtml(date.toISOString())}">${escapeHtml(formatSourceTimestamp(date))}</time>`;
}

// ---------------------------------------------------------------------
// Filename-date extraction — pulls a `source-YYYY-MM-DD` segment out of
// a wiki path. Used by the recent-activity sort and date-pill render.
// ---------------------------------------------------------------------

export function sourceDateFromPath(path) {
  return String(path || "").match(/(?:^|\/)source-(\d{4}-\d{2}-\d{2})/)?.[1] || "";
}
