// Wiki view ("Files" tab) — Quiet redesign renderer (Phase 2).
//
// The Files tab is a two-pane "spread": a left-side bucketed index of
// vault files and a right-side hover/pin preview. Clicking Edit on the
// preview reveals the doc-editor (preserved inside #qfiles-edit-mode)
// so external selectVaultPath() callers (graph, entities, dream) still
// land on the editor with the file's body populated.
//
// External shape required from the host (set via initWikiView):
//   els: {
//     // legacy (sidebar stats + doc editor — preserved):
//     vaultTree, docBody, docSaveBtn, docDeleteBtn,
//     // new Quiet markup ids:
//     qfilesShell, qfilesPullquote, qfilesSearch, qfilesIndexBody,
//     qfilesPreview, qfilesPreviewEmpty, qfilesEmptyStats,
//     qfilesPreviewContent, qfilesPreviewTitle, qfilesPreviewPath,
//     qfilesPreviewExcerpt, qfilesPreviewExtended, qfilesPreviewMore,
//     qfilesPreviewEdited, qfilesPreviewWords, qfilesPreviewTags,
//     qfilesPreviewConnections, qfilesPreviewConnPills,
//     qfilesPreviewEditBtn, qfilesPreviewPinBtn,
//     qfilesEditMode, qfilesEditBack,
//     qfilesPalette, qfilesPaletteBackdrop, qfilesPaletteInput,
//     qfilesPaletteResults
//   }
//   callbacks: {
//     renderRecentActivity, renderDream, renderEntities,
//     activeActivityFileMap, ingestionStats,
//     setDocumentHeader, setDocBody, updateSaveButtonState,
//     pathKind, rawFileForPath, rawSourceOutputPath, allSourceFiles
//   }
//
// `selectVaultPath` is exported so non-wiki call sites (graph onOpenNode,
// entity card click handlers, dream open-action flows) can reuse it. It
// flips the Files tab into edit-mode so the doc-body is visible.

import { state } from "../core/state.js";
import { escapeHtml, formatStatNumber } from "../core/utils.js";
import { normalizeMarginsPath } from "../core/wiki.js";
import {
  quietAggregateStats,
  quietBuildAllRecords,
  quietParseFrontmatter,
  quietSearchMatches
} from "./filesQuietHelpers.js";

// ---------------------------------------------------------------------
// Operating-files registry — paths that live at the vault root and are
// always shown above raw/ in the (legacy) file tree. Kept for the
// isOperatingBrowserPath export which the rest of app.js still uses.
// ---------------------------------------------------------------------

const ROOT_GENERATED_TEXT_FILES = new Set(["CLAUDE.md", "operator-manual.md", "query-cookbook.md"]);

// ---------------------------------------------------------------------
// Bucket → CSS custom-property mapping. Drives the polychrome accent
// strip on each bucket heading (set via inline style="--bucket-color: …").
// ---------------------------------------------------------------------

const BUCKET_COLORS = {
  entities: "var(--cobalt)",
  career: "var(--green-poly, var(--green))",
  concepts: "var(--violet)",
  sources: "var(--mustard)",
  synthesis: "var(--vermillion)",
  meta: "var(--meta, var(--ink-muted, #888))"
};

const BUCKET_LABELS = {
  entities: "Entities",
  career: "Career",
  concepts: "Concepts",
  sources: "Sources",
  synthesis: "Synthesis",
  meta: "Meta"
};

// Bucket order: entities first, meta last, alphabetical between.
const BUCKET_ORDER = ["entities", "career", "concepts", "sources", "synthesis", "meta"];

// Kandinsky-esque glyph per bucket. Each is an asymmetric composition
// using the Margins polychrome palette (vermillion / cobalt / mustard /
// violet / green-poly / ink-poly) so the Files-tab sections feel of-a-
// piece with the Activity drop-zone art. Inline SVG so they ship as one
// stylesheet — no extra fetches, no icon font.
const BUCKET_GLYPHS = {
  entities: `
    <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <circle cx="14" cy="18" r="9.5" fill="var(--cobalt)"/>
      <circle cx="23" cy="9" r="3.5" fill="var(--vermillion)"/>
      <path d="M5 22 Q9 8 19 4" fill="none" stroke="var(--ink-poly)" stroke-width="1.4" stroke-linecap="round"/>
    </svg>`,
  career: `
    <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <circle cx="11" cy="18" r="8" fill="var(--green-poly)"/>
      <polygon points="17,5 26,25 7,26" fill="none" stroke="var(--ink-poly)" stroke-width="1.4" stroke-linejoin="round"/>
      <circle cx="24" cy="8" r="2.5" fill="var(--mustard)"/>
    </svg>`,
  concepts: `
    <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <circle cx="14" cy="15" r="8.5" fill="var(--violet)"/>
      <path d="M3 28 Q14 5 28 18" fill="none" stroke="var(--mustard)" stroke-width="2" stroke-linecap="round"/>
      <circle cx="26" cy="6" r="2" fill="var(--ink-poly)"/>
    </svg>`,
  sources: `
    <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <rect x="6" y="6" width="15" height="15" fill="var(--mustard)" transform="rotate(14 13.5 13.5)"/>
      <circle cx="25" cy="10" r="3" fill="var(--vermillion)"/>
      <line x1="4" y1="27" x2="26" y2="23" stroke="var(--cobalt)" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
  synthesis: `
    <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <circle cx="14" cy="16" r="10" fill="var(--vermillion)"/>
      <circle cx="14" cy="16" r="4.5" fill="var(--mustard)"/>
      <path d="M3 8 Q12 28 28 12" fill="none" stroke="var(--cobalt)" stroke-width="1.4" stroke-linecap="round"/>
      <circle cx="14" cy="16" r="1.4" fill="var(--ink-poly)"/>
    </svg>`,
  meta: `
    <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <circle cx="12" cy="14" r="6" fill="var(--ink-poly)"/>
      <circle cx="23" cy="8" r="2.6" fill="var(--mustard)"/>
      <circle cx="24" cy="23" r="2" fill="var(--violet)"/>
      <circle cx="7" cy="23" r="1.6" fill="var(--cobalt)"/>
    </svg>`
};

// Tone mapping for tag pills. Falls back to "accent" if the tag string
// doesn't trip any of the heuristics below. Lowercased substring match.
const TONE_RULES = [
  { tone: "green", words: ["career", "advisor", "wealth", "client", "rev", "growth", "partner"] },
  { tone: "violet", words: ["product", "security", "compliance", "tech", "ai", "ml", "dev"] },
  { tone: "cobalt", words: ["family", "person", "people", "contact", "entity", "friend"] },
  { tone: "mustard", words: ["source", "meeting", "daily", "note", "session", "ingest"] },
  { tone: "vermillion", words: ["synthesis", "query", "summary", "review", "warning", "risk"] },
  { tone: "firm", words: ["firm", "company", "org", "team"] },
  { tone: "source", words: ["raw", "transcript", "doc"] },
  { tone: "concept", words: ["concept", "idea", "model", "framework"] }
];

function toneForTag(tag) {
  const lower = (tag || "").toLowerCase();
  for (const rule of TONE_RULES) {
    if (rule.words.some((w) => lower.includes(w))) return rule.tone;
  }
  return "accent";
}

// ---------------------------------------------------------------------
// Host-supplied wiring (DOM + callbacks)
// ---------------------------------------------------------------------

let els = null;
let callbacks = {};

// Per-view state local to this module. Avoid leaking into global state.
// `qfilesPinnedPath` graduates to state.qfilesPinnedPath so other modules
// can read it if needed (e.g. external selectVaultPath calls).
let hoverTimerId = 0;
let hoverPath = null;            // currently hovered row (not yet pinned)
let displayedPath = null;        // path currently rendered in preview
let paletteResults = [];
let paletteActiveIndex = 0;
let recordsByPath = new Map();    // last render's records, keyed by path
let lastRecords = [];             // last render's records (sorted)
let lastSearchValue = "";
let expandedBuckets = new Set();   // bucket keys the user has clicked "Show more" on
let refCounts = new Map();         // path → incoming reference count

// Default cap per bucket. Top N most-referenced files are visible; the
// rest live behind the "Show N more" expander.
const BUCKET_VISIBLE_LIMIT = 5;

// Memoization: rebuilding 600+ records on every render is wasteful when
// nothing has changed except the search query. Hash the fileMap by
// size + a sampled key set so we can short-circuit.
let memoSignature = "";
let memoRecords = [];

export function initWikiView(deps) {
  els = deps.els || {};
  callbacks = deps.callbacks || {};
  if (!state.qfilesPinnedPath) state.qfilesPinnedPath = null;
  wireQuietInteractions();
}

// ---------------------------------------------------------------------
// Stat panel (sidebar) — UNCHANGED contract. Some markup may be missing
// in the Quiet redesign (no `wikiTree`, no `vaultSearch`); we guard.
// ---------------------------------------------------------------------

export function renderVaultTree(fileMap = state.currentFileMap) {
  callbacks.renderRecentActivity?.(fileMap || callbacks.activeActivityFileMap?.());
  callbacks.renderDream?.(fileMap || callbacks.activeActivityFileMap?.());
  callbacks.renderEntities?.(fileMap || new Map());
  if (!els || !els.vaultTree || els.vaultTree.hidden) return;
  const stats = callbacks.ingestionStats?.(fileMap || new Map()) || {};
  els.vaultTree.innerHTML = `
    <div class="upload-stats">
      <div class="section-kicker">Processing</div>
      <div class="upload-stat-grid">
        ${uploadStat("Parsed", stats.parsedFiles)}
        ${uploadStat("Processed", stats.ingestedFiles)}
        ${uploadStat("Pending", stats.pendingFiles)}
        ${uploadStat("Words", formatStatNumber(stats.totalWords))}
      </div>
      <div class="upload-detail-list">
        ${uploadDetail("Model attempts", stats.modelCalls)}
        ${uploadDetail("Wiki notes", stats.wikiFiles)}
        ${uploadDetail("Cited links", stats.graphEdges)}
        ${uploadDetail("Needs extraction", stats.needsExtraction)}
        ${uploadDetail("Unsaved edits", stats.unsavedEdits)}
      </div>
    </div>
  `;
}

function uploadStat(label, value) {
  return `
    <div class="upload-stat">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function uploadDetail(label, value) {
  return `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(formatStatNumber(value))}</strong>
    </div>
  `;
}

// ---------------------------------------------------------------------
// Public predicate retained for app.js cross-references.
// ---------------------------------------------------------------------

export function isOperatingBrowserPath(path) {
  const normalizedPath = normalizeMarginsPath(path);
  return ROOT_GENERATED_TEXT_FILES.has(normalizedPath) ||
    normalizedPath.startsWith("commands/") ||
    normalizedPath.startsWith("agents/");
}

// ---------------------------------------------------------------------
// mtime derivation — best-effort. Frontmatter date fields beat filename
// date stems. Falls through to undefined (helpers render "—").
// ---------------------------------------------------------------------

const FILENAME_DATE_RE = /(\d{4})-(\d{2})-(\d{2})/;

function mtimeForFile(path, body) {
  const fm = quietParseFrontmatter(body || "");
  const fromFm = fm.last_modified || fm.updated || fm.date || fm.created;
  if (typeof fromFm === "string") {
    const t = Date.parse(fromFm);
    if (!Number.isNaN(t)) return t;
  }
  const m = FILENAME_DATE_RE.exec(path || "");
  if (m) {
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
    if (!Number.isNaN(t)) return t;
  }
  return undefined;
}

function buildMtimes(fileMap) {
  const mtimes = new Map();
  if (!fileMap || typeof fileMap.entries !== "function") return mtimes;
  for (const [path, body] of fileMap.entries()) {
    if (typeof path !== "string") continue;
    const t = mtimeForFile(path, body);
    if (typeof t === "number") mtimes.set(path, t);
  }
  return mtimes;
}

// ---------------------------------------------------------------------
// File-set filter: only `wiki/` markdown, excluding `_templates/` and
// `.margins/`. Matches the rule the old vault tree enforced.
// ---------------------------------------------------------------------

function filteredFileMap(fileMap) {
  const filtered = new Map();
  if (!fileMap || typeof fileMap.entries !== "function") return filtered;
  for (const [path, body] of fileMap.entries()) {
    if (typeof path !== "string" || !path) continue;
    if (!path.startsWith("wiki/")) continue;
    if (path.startsWith("wiki/_templates/")) continue;
    if (path.startsWith("wiki/.margins/")) continue;
    if (!path.endsWith(".md")) continue;
    // Skip "bucket overview" pages — wiki/entities/entities.md,
    // wiki/career/career.md, wiki/concepts/index.md, etc. The bucket
    // heading in the Quiet UI already represents the category, so a
    // file titled after its parent folder is visual duplication.
    const parts = path.split("/");
    if (parts.length === 3) {
      const folder = parts[1];
      const stem = parts[2].replace(/\.md$/i, "");
      if (stem === folder || stem === "index") continue;
    }
    filtered.set(path, body);
  }
  return filtered;
}

function fileMapSignature(fileMap) {
  if (!fileMap || typeof fileMap.size !== "number") return "empty";
  const size = fileMap.size;
  // Sample first/last keys for change detection. Cheap; not perfect, but
  // a Save/Delete will swap the file body which renderWikiFiles is
  // already re-invoked after, and we also fold body length of the head
  // entry in so swap-of-body invalidates the cache.
  let head = "";
  let tail = "";
  let bodyLen = 0;
  const iter = fileMap.entries();
  const first = iter.next();
  if (!first.done) {
    head = first.value[0];
    bodyLen = (first.value[1] || "").length;
  }
  for (const [k] of fileMap) tail = k;
  return `${size}|${head}|${bodyLen}|${tail}`;
}

// ---------------------------------------------------------------------
// renderWikiFiles — public entry. Rebuild records, run search, render
// the bucketed index, refresh pull-quote, optionally refresh the
// preview pane in-place (if a pin is active).
// ---------------------------------------------------------------------

export function renderWikiFiles(fileMap) {
  if (!els || !els.qfilesIndexBody) return;
  const source = fileMap || state.currentFileMap || new Map();
  const wikiOnly = filteredFileMap(source);

  const signature = fileMapSignature(wikiOnly);
  let records;
  if (signature === memoSignature) {
    records = memoRecords;
  } else {
    const mtimes = buildMtimes(wikiOnly);
    records = quietBuildAllRecords(wikiOnly, mtimes);
    memoSignature = signature;
    memoRecords = records;
  }
  lastRecords = records;
  recordsByPath = new Map(records.map((r) => [r.path, r]));
  refCounts = computeRefCounts(records);

  // Pull-quote aggregate stats.
  const stats = quietAggregateStats(records);
  if (els.qfilesPullquote) {
    if (records.length === 0) {
      els.qfilesPullquote.textContent = "Open a vault to browse files.";
    } else {
      els.qfilesPullquote.textContent =
        `${records.length} file${records.length === 1 ? "" : "s"}` +
        ` · ${formatStatNumber(stats.totalWords)} words` +
        ` · last touched ${stats.lastEditedAge}`;
    }
  }

  // Empty-state hint inside the preview pane when no file is hovered/pinned.
  if (els.qfilesEmptyStats) {
    els.qfilesEmptyStats.textContent = records.length === 0
      ? "No vault loaded yet."
      : `${records.length} files indexed · ${formatStatNumber(stats.totalWords)} words across the vault.`;
  }

  // Search.
  const query = (els.qfilesSearch?.value || "").trim();
  lastSearchValue = query;
  const matchedPaths = query ? quietSearchMatches(records, query) : null;

  // Render the index. If empty, show a friendly message.
  if (records.length === 0) {
    els.qfilesIndexBody.innerHTML =
      `<div class="qfiles-bucket-empty">Open a vault or add documents to browse files.</div>`;
  } else {
    els.qfilesIndexBody.innerHTML = renderQuietIndex(records, matchedPaths);
  }

  // Pin state: if the pinned path no longer exists, drop it. Otherwise
  // re-mark the row + keep the preview content in sync.
  if (state.qfilesPinnedPath && !recordsByPath.has(state.qfilesPinnedPath)) {
    state.qfilesPinnedPath = null;
  }
  if (state.qfilesPinnedPath) {
    markActiveRow(state.qfilesPinnedPath);
    showPreviewForPath(state.qfilesPinnedPath, { pinned: true });
  } else if (displayedPath && recordsByPath.has(displayedPath)) {
    // Refresh preview content if the previously-hovered file is still rendered.
    showPreviewForPath(displayedPath, { pinned: false });
  } else {
    clearPreview();
  }
}

// Compute incoming-reference count per record. For each connection on
// each record, increment the target's count. Files referenced by many
// other files float to the top of their bucket — they're the load-bearing
// entries the user most likely wants to find first.
function computeRefCounts(records) {
  const counts = new Map();
  for (const rec of records) counts.set(rec.path, 0);
  for (const rec of records) {
    for (const conn of (rec.connections || [])) {
      if (conn?.target && counts.has(conn.target)) {
        counts.set(conn.target, counts.get(conn.target) + 1);
      }
    }
  }
  return counts;
}

function ageWeight(rec) {
  // Newer files sort first within the same ref count. mtime is epoch
  // ms when known; undefined falls to the bottom.
  return typeof rec.mtime === "number" ? rec.mtime : 0;
}

function renderQuietIndex(records, matchedPaths) {
  const groups = new Map();
  for (const key of BUCKET_ORDER) groups.set(key, []);
  for (const rec of records) {
    const key = groups.has(rec.bucket) ? rec.bucket : "meta";
    groups.get(key).push(rec);
  }
  const parts = [];
  for (const key of BUCKET_ORDER) {
    const list = groups.get(key) || [];
    if (list.length === 0) continue;
    // Sort by incoming-reference count desc, then recency desc.
    list.sort((a, b) => {
      const ra = refCounts.get(a.path) || 0;
      const rb = refCounts.get(b.path) || 0;
      if (rb !== ra) return rb - ra;
      return ageWeight(b) - ageWeight(a);
    });
    parts.push(renderBucket(key, list, matchedPaths));
  }
  return parts.join("");
}

function renderBucket(key, list, matchedPaths) {
  const color = BUCKET_COLORS[key] || BUCKET_COLORS.meta;
  const label = BUCKET_LABELS[key] || key;
  // If a search is active, show all matching files in the bucket (don't
  // hide matches behind "Show more"). Otherwise apply the visible cap.
  const isExpanded = expandedBuckets.has(key);
  const searchActive = !!matchedPaths;
  const visibleLimit = searchActive || isExpanded ? list.length : BUCKET_VISIBLE_LIMIT;
  const visibleList = list.slice(0, visibleLimit);
  const hiddenCount = list.length - visibleList.length;
  const rows = visibleList.map((rec) => renderBucketRow(rec, matchedPaths)).join("");
  const moreButton = hiddenCount > 0
    ? `<button type="button" class="qfiles-bucket-more" data-bucket-more="${escapeHtml(key)}">Show ${hiddenCount} more</button>`
    : (isExpanded && list.length > BUCKET_VISIBLE_LIMIT
        ? `<button type="button" class="qfiles-bucket-more is-collapse" data-bucket-more="${escapeHtml(key)}">Show fewer</button>`
        : "");
  const sectionClass = isExpanded ? "qfiles-bucket is-expanded" : "qfiles-bucket";
  const glyph = BUCKET_GLYPHS[key] || "";
  return `
    <section class="${sectionClass}" data-bucket="${escapeHtml(key)}" style="--bucket-color: ${color}">
      <header class="qfiles-bucket-heading">
        <span class="qfiles-bucket-glyph" aria-hidden="true">${glyph}</span>
        <span class="qfiles-bucket-label">${escapeHtml(label)}</span>
        <span class="qfiles-bucket-count">${list.length}</span>
      </header>
      <div class="qfiles-bucket-list">${rows}</div>
      ${moreButton}
    </section>
  `;
}

function renderBucketRow(rec, matchedPaths) {
  const classes = ["qfiles-bucket-item"];
  if (matchedPaths) {
    if (matchedPaths.has(rec.path)) classes.push("is-glow");
    else classes.push("is-dim");
  }
  if (rec.path === state.qfilesPinnedPath) classes.push("is-active");
  const subPath = rec.path.replace(/^wiki\//, "").replace(/\.md$/i, "");
  return `
    <button class="${classes.join(" ")}" type="button" data-path="${escapeHtml(rec.path)}">
      <span class="qfiles-item-main">
        <span class="qfiles-item-title">${escapeHtml(rec.title)}</span>
        <span class="qfiles-item-path">${escapeHtml(subPath)}</span>
      </span>
      <span class="qfiles-item-age">${escapeHtml(rec.age || "—")}</span>
    </button>
  `;
}

function markActiveRow(path) {
  if (!els.qfilesIndexBody) return;
  els.qfilesIndexBody.querySelectorAll(".qfiles-bucket-item.is-active").forEach((row) => {
    if (row.dataset.path !== path) row.classList.remove("is-active");
  });
  if (!path) return;
  const row = els.qfilesIndexBody.querySelector(`.qfiles-bucket-item[data-path="${cssAttrEscape(path)}"]`);
  if (row) row.classList.add("is-active");
}

function cssAttrEscape(value) {
  return String(value || "").replace(/["\\]/g, "\\$&");
}

// ---------------------------------------------------------------------
// Preview pane render
// ---------------------------------------------------------------------

function showPreviewForPath(path, options = {}) {
  if (!path || !recordsByPath.has(path)) {
    clearPreview();
    return;
  }
  const rec = recordsByPath.get(path);
  displayedPath = path;

  if (els.qfilesPreviewEmpty) els.qfilesPreviewEmpty.hidden = true;
  if (els.qfilesPreviewContent) els.qfilesPreviewContent.hidden = false;
  if (els.qfilesPreview) {
    els.qfilesPreview.classList.toggle("is-pinned", !!options.pinned);
    els.qfilesPreview.classList.remove("is-expanded");
  }

  if (els.qfilesPreviewTitle) els.qfilesPreviewTitle.textContent = rec.title || "Untitled";
  if (els.qfilesPreviewPath) els.qfilesPreviewPath.textContent = rec.path;
  if (els.qfilesPreviewExcerpt) els.qfilesPreviewExcerpt.textContent = rec.excerpt || "";
  if (els.qfilesPreviewExtended) {
    const ext = rec.extended || "";
    els.qfilesPreviewExtended.textContent = ext;
    els.qfilesPreviewExtended.hidden = true;
  }
  if (els.qfilesPreviewMore) {
    els.qfilesPreviewMore.hidden = !(rec.extended && rec.extended.length > 0);
    els.qfilesPreviewMore.textContent = "Read more";
  }
  if (els.qfilesPreviewEdited) {
    els.qfilesPreviewEdited.textContent = `Edited ${rec.lastEditedLabel || rec.age || "—"}`;
  }
  if (els.qfilesPreviewWords) {
    els.qfilesPreviewWords.textContent = `${formatStatNumber(rec.words || 0)} words`;
  }
  renderPreviewTags(rec.tags || []);
  renderPreviewConnections(rec.connections || []);
  if (els.qfilesPreviewPinBtn) {
    els.qfilesPreviewPinBtn.textContent = options.pinned ? "Unpin" : "Pin";
    els.qfilesPreviewPinBtn.classList.toggle("is-pinned", !!options.pinned);
  }
}

function renderPreviewTags(tags) {
  if (!els.qfilesPreviewTags) return;
  if (!tags.length) {
    els.qfilesPreviewTags.innerHTML = "";
    return;
  }
  const visible = tags.slice(0, 3);
  const overflow = tags.slice(3);
  const visibleHtml = visible.map((t) =>
    `<span class="qfiles-preview-tag tone-${escapeHtml(toneForTag(t))}">${escapeHtml(t)}</span>`
  ).join("");
  const overflowHtml = overflow.length
    ? `<button type="button" class="qfiles-preview-tag tone-meta qfiles-tag-overflow" data-overflow="1">+${overflow.length} more</button>`
    : "";
  const overflowExpanded = overflow.length
    ? `<span class="qfiles-tag-overflow-list" hidden>${overflow.map((t) =>
        `<span class="qfiles-preview-tag tone-${escapeHtml(toneForTag(t))}">${escapeHtml(t)}</span>`
      ).join("")}</span>`
    : "";
  els.qfilesPreviewTags.innerHTML = `${visibleHtml}${overflowHtml}${overflowExpanded}`;
}

function renderPreviewConnections(conns) {
  if (!els.qfilesPreviewConnections || !els.qfilesPreviewConnPills) return;
  if (!conns.length) {
    els.qfilesPreviewConnections.hidden = true;
    els.qfilesPreviewConnPills.innerHTML = "";
    return;
  }
  els.qfilesPreviewConnections.hidden = false;
  els.qfilesPreviewConnPills.innerHTML = conns.map((c) => {
    const label = escapeHtml(c.label || "");
    if (c.target) {
      return `<button type="button" class="qfiles-conn-pill" data-target="${escapeHtml(c.target)}">${label}</button>`;
    }
    return `<span class="qfiles-conn-pill is-missing"><em>${label}</em></span>`;
  }).join("");
}

function clearPreview() {
  displayedPath = null;
  if (els.qfilesPreviewEmpty) els.qfilesPreviewEmpty.hidden = false;
  if (els.qfilesPreviewContent) els.qfilesPreviewContent.hidden = true;
  if (els.qfilesPreview) {
    els.qfilesPreview.classList.remove("is-pinned");
    els.qfilesPreview.classList.remove("is-expanded");
  }
}

// ---------------------------------------------------------------------
// Interaction wiring (hover, click-to-pin, search, palette, edit toggle)
// ---------------------------------------------------------------------

function wireQuietInteractions() {
  if (!els) return;

  // Hover-to-preview, click-to-pin on the index.
  if (els.qfilesIndexBody) {
    els.qfilesIndexBody.addEventListener("mouseover", handleIndexMouseOver);
    els.qfilesIndexBody.addEventListener("mouseleave", handleIndexMouseLeave);
    els.qfilesIndexBody.addEventListener("click", handleIndexClick);
  }

  // Preview-pane buttons.
  els.qfilesPreviewEditBtn?.addEventListener("click", handleEditClick);
  els.qfilesPreviewPinBtn?.addEventListener("click", handlePinToggleClick);
  els.qfilesPreviewMore?.addEventListener("click", handleReadMoreClick);
  els.qfilesPreviewTags?.addEventListener("click", handleTagOverflowClick);
  els.qfilesPreviewConnPills?.addEventListener("click", handleConnectionClick);

  // Edit-mode back button.
  els.qfilesEditBack?.addEventListener("click", () => {
    if (els.qfilesEditMode) els.qfilesEditMode.hidden = true;
  });

  // Search.
  els.qfilesSearch?.addEventListener("input", handleSearchInput);
  els.qfilesSearch?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      els.qfilesSearch.value = "";
      handleSearchInput();
    }
  });

  // Command palette.
  els.qfilesPaletteBackdrop?.addEventListener("click", closePalette);
  els.qfilesPaletteInput?.addEventListener("input", handlePaletteInput);
  els.qfilesPaletteInput?.addEventListener("keydown", handlePaletteKeydown);
  els.qfilesPaletteResults?.addEventListener("click", handlePaletteResultClick);
  els.qfilesPaletteResults?.addEventListener("mouseover", handlePaletteResultHover);

  // Global hotkeys: '/' focuses search, Cmd/Ctrl+K opens palette.
  document.addEventListener("keydown", handleGlobalHotkey);
}

function isFilesTabActive() {
  return !!document.getElementById("wiki-view")?.classList.contains("active");
}

function isTypingInField(target) {
  if (!target || target.nodeType !== 1) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function handleGlobalHotkey(event) {
  // Cmd/Ctrl+K → palette. Works only when Files tab is active.
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    if (!isFilesTabActive()) return;
    event.preventDefault();
    openPalette();
    return;
  }
  // '/' → focus search (Files tab only, not when typing).
  if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    if (!isFilesTabActive()) return;
    if (isTypingInField(event.target)) return;
    if (!els.qfilesSearch) return;
    event.preventDefault();
    els.qfilesSearch.focus();
    els.qfilesSearch.select();
  }
  // Escape closes the palette if it is open.
  if (event.key === "Escape" && els.qfilesPalette && !els.qfilesPalette.hidden) {
    closePalette();
  }
}

function handleIndexMouseOver(event) {
  const row = event.target.closest(".qfiles-bucket-item[data-path]");
  if (!row) return;
  const path = row.dataset.path;
  if (!path) return;
  if (state.qfilesPinnedPath) return; // pin wins
  clearTimeout(hoverTimerId);
  hoverPath = path;
  hoverTimerId = setTimeout(() => {
    if (state.qfilesPinnedPath) return;
    showPreviewForPath(path, { pinned: false });
  }, 200);
}

function handleIndexMouseLeave() {
  clearTimeout(hoverTimerId);
  hoverPath = null;
  if (state.qfilesPinnedPath) return;
  clearPreview();
}

function handleIndexClick(event) {
  // Show-more / Show-fewer toggle on a bucket section. Check this BEFORE
  // the row click so a click on the expander doesn't bubble into a row.
  const moreBtn = event.target.closest(".qfiles-bucket-more[data-bucket-more]");
  if (moreBtn) {
    const key = moreBtn.dataset.bucketMore;
    if (expandedBuckets.has(key)) expandedBuckets.delete(key);
    else expandedBuckets.add(key);
    // Re-render the index with current search state; keep pin row marked.
    handleSearchInput();
    return;
  }
  const row = event.target.closest(".qfiles-bucket-item[data-path]");
  if (!row) return;
  const path = row.dataset.path;
  if (!path) return;
  if (state.qfilesPinnedPath === path) {
    // Click pinned row → unpin.
    state.qfilesPinnedPath = null;
    markActiveRow(null);
    if (hoverPath && hoverPath !== path) {
      showPreviewForPath(hoverPath, { pinned: false });
    } else {
      clearPreview();
    }
    return;
  }
  state.qfilesPinnedPath = path;
  markActiveRow(path);
  showPreviewForPath(path, { pinned: true });
}

function handlePinToggleClick() {
  if (!displayedPath) return;
  if (state.qfilesPinnedPath === displayedPath) {
    state.qfilesPinnedPath = null;
    markActiveRow(null);
    showPreviewForPath(displayedPath, { pinned: false });
  } else {
    state.qfilesPinnedPath = displayedPath;
    markActiveRow(displayedPath);
    showPreviewForPath(displayedPath, { pinned: true });
  }
}

function handleEditClick() {
  const path = state.qfilesPinnedPath || displayedPath || hoverPath;
  if (!path) return;
  selectVaultPath(path);
}

function handleReadMoreClick() {
  if (!els.qfilesPreview) return;
  const expanded = els.qfilesPreview.classList.toggle("is-expanded");
  if (els.qfilesPreviewExtended) els.qfilesPreviewExtended.hidden = !expanded;
  if (els.qfilesPreviewMore) els.qfilesPreviewMore.textContent = expanded ? "Read less" : "Read more";
}

function handleTagOverflowClick(event) {
  const trigger = event.target.closest(".qfiles-tag-overflow");
  if (!trigger) return;
  const overflowList = trigger.parentElement?.querySelector(".qfiles-tag-overflow-list");
  if (!overflowList) return;
  overflowList.hidden = !overflowList.hidden;
  trigger.classList.toggle("is-expanded", !overflowList.hidden);
}

function handleConnectionClick(event) {
  const btn = event.target.closest(".qfiles-conn-pill[data-target]");
  if (!btn) return;
  const target = btn.dataset.target;
  if (!target) return;
  // Glow + scroll the target row in the index.
  const row = els.qfilesIndexBody?.querySelector(`.qfiles-bucket-item[data-path="${cssAttrEscape(target)}"]`);
  if (row) {
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.classList.add("is-glow");
    setTimeout(() => row.classList.remove("is-glow"), 1200);
  }
  // Also flip the preview to it (non-pinning hover-equivalent).
  if (recordsByPath.has(target) && !state.qfilesPinnedPath) {
    showPreviewForPath(target, { pinned: false });
  }
}

function handleSearchInput() {
  if (!els.qfilesIndexBody) return;
  const query = (els.qfilesSearch?.value || "").trim();
  lastSearchValue = query;
  const matchedPaths = query ? quietSearchMatches(lastRecords, query) : null;
  // Re-render index only (cheap — DOM swap of innerHTML).
  if (lastRecords.length === 0) return;
  els.qfilesIndexBody.innerHTML = renderQuietIndex(lastRecords, matchedPaths);
  // Restore is-active on the pinned row after innerHTML swap.
  if (state.qfilesPinnedPath) markActiveRow(state.qfilesPinnedPath);
}

// ---------------------------------------------------------------------
// Command palette
// ---------------------------------------------------------------------

function openPalette() {
  if (!els.qfilesPalette) return;
  els.qfilesPalette.hidden = false;
  if (els.qfilesPaletteInput) {
    els.qfilesPaletteInput.value = "";
    els.qfilesPaletteInput.focus();
  }
  paletteResults = [];
  paletteActiveIndex = 0;
  renderPaletteResults("");
}

function closePalette() {
  if (!els.qfilesPalette) return;
  els.qfilesPalette.hidden = true;
}

function handlePaletteInput() {
  const query = els.qfilesPaletteInput?.value || "";
  paletteActiveIndex = 0;
  renderPaletteResults(query);
}

function renderPaletteResults(query) {
  if (!els.qfilesPaletteResults) return;
  const q = query.trim().toLowerCase();
  let candidates;
  if (!q) {
    candidates = lastRecords.slice(0, 8);
  } else {
    const matched = quietSearchMatches(lastRecords, q);
    candidates = lastRecords.filter((r) => matched && matched.has(r.path)).slice(0, 8);
  }
  paletteResults = candidates;
  if (paletteActiveIndex >= candidates.length) paletteActiveIndex = 0;
  if (candidates.length === 0) {
    els.qfilesPaletteResults.innerHTML =
      `<div class="qfiles-palette-empty">No matches.</div>`;
    return;
  }
  els.qfilesPaletteResults.innerHTML = candidates.map((rec, idx) => {
    const subPath = rec.path.replace(/^wiki\//, "").replace(/\.md$/i, "");
    const classes = ["qfiles-palette-result"];
    if (idx === paletteActiveIndex) classes.push("is-active");
    return `
      <div class="${classes.join(" ")}" data-index="${idx}" data-path="${escapeHtml(rec.path)}">
        <div class="qfiles-palette-title">${escapeHtml(rec.title)}</div>
        <div class="qfiles-palette-path">${escapeHtml(subPath)}</div>
      </div>
    `;
  }).join("");
}

function handlePaletteKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    closePalette();
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (paletteResults.length === 0) return;
    paletteActiveIndex = (paletteActiveIndex + 1) % paletteResults.length;
    updatePaletteActive();
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (paletteResults.length === 0) return;
    paletteActiveIndex = (paletteActiveIndex - 1 + paletteResults.length) % paletteResults.length;
    updatePaletteActive();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    const rec = paletteResults[paletteActiveIndex];
    if (!rec) return;
    pinFromPalette(rec.path);
  }
}

function updatePaletteActive() {
  if (!els.qfilesPaletteResults) return;
  els.qfilesPaletteResults.querySelectorAll(".qfiles-palette-result").forEach((row) => {
    const idx = Number(row.dataset.index);
    row.classList.toggle("is-active", idx === paletteActiveIndex);
    if (idx === paletteActiveIndex) {
      row.scrollIntoView({ block: "nearest" });
    }
  });
}

function handlePaletteResultClick(event) {
  const row = event.target.closest(".qfiles-palette-result[data-path]");
  if (!row) return;
  pinFromPalette(row.dataset.path);
}

function handlePaletteResultHover(event) {
  const row = event.target.closest(".qfiles-palette-result[data-index]");
  if (!row) return;
  const idx = Number(row.dataset.index);
  if (Number.isNaN(idx) || idx === paletteActiveIndex) return;
  paletteActiveIndex = idx;
  updatePaletteActive();
}

function pinFromPalette(path) {
  if (!path) return;
  closePalette();
  if (!recordsByPath.has(path)) return;
  state.qfilesPinnedPath = path;
  markActiveRow(path);
  showPreviewForPath(path, { pinned: true });
  // Scroll the row into view.
  const row = els.qfilesIndexBody?.querySelector(`.qfiles-bucket-item[data-path="${cssAttrEscape(path)}"]`);
  if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
}

// ---------------------------------------------------------------------
// File selection (exported — used by graph onOpenNode + entity click +
// dream open-action + inline activity links). Reveals edit mode so the
// doc-editor (preserved inside #qfiles-edit-mode) is visible.
// ---------------------------------------------------------------------

export function selectVaultPath(path, options = {}) {
  if (!els) return false;
  const normalizedPath = normalizeMarginsPath(path);
  const rawFileForPath = callbacks.rawFileForPath;
  const rawSourceOutputPath = callbacks.rawSourceOutputPath || ((name) => `raw/${name}`);
  const rawFile = rawFileForPath?.(normalizedPath);

  let resolved = false;
  if (rawFile) {
    state.selectedPath = rawSourceOutputPath(rawFile.name);
    state.selectedKind = "raw";
    const body = rawFile.text || (rawFile.type === "pdf" ? "PDF source preserved in raw/." : "Original file preserved in raw/.");
    const readOnly = (rawFile.type === "pdf" || rawFile.type === "attachment") && !rawFile.text;
    callbacks.setDocumentHeader?.(state.selectedPath, body, { kind: "raw", readOnly });
    callbacks.setDocBody?.(body, { readOnly });
    resolved = true;
  } else if (state.currentFileMap?.has(normalizedPath)) {
    state.selectedPath = normalizedPath;
    state.selectedKind = normalizedPath.startsWith("wiki/") ? "wiki" : "system";
    const body = state.currentFileMap.get(normalizedPath);
    callbacks.setDocumentHeader?.(normalizedPath, body, { kind: state.selectedKind, readOnly: false });
    callbacks.setDocBody?.(body, { readOnly: false });
    resolved = true;
  }

  if (!resolved) return false;

  // Reveal the editor pane. The CSS hides the spread automatically when
  // #qfiles-edit-mode is visible (see body:has rule in styles.css).
  if (els.qfilesEditMode) els.qfilesEditMode.hidden = false;

  if (!options.preserveFocus && document.activeElement !== els?.docBody) {
    els?.docBody?.focus({ preventScroll: true });
  }
  callbacks.updateSaveButtonState?.();
  return true;
}
