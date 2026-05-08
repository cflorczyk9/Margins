// Entities view ("Entities" tab) — board of pinned + recent entity cards.
//
// Phase 9D of the module-split refactor. Pulls render + handlers + state
// mutations out of app.js. Pure logic (record construction, predicates,
// faceting, sort, type/bucket labels) lives in core/entities.js.
//
// External shape required from the host (set via initEntitiesView):
//   els: { entityBrowser, entityControls, entityMeta, entitySearch,
//          entityTypeFilters, entityTagFilters, stats }
//   callbacks: {
//     selectVaultPath, activateTab, renderWikiFiles, drawGraph,
//     graphFromFileMap, requestVaultPermission, writeTextFile,
//     updateVaultStatus, setDocumentHeader, setDocBody,
//     updateSaveButtonState, withBusyOperation
//   }
//
// `selectVaultPath` is intentionally injected as a callback rather than
// imported from views/wiki.js — keeps sibling views decoupled.
//
// Cross-module deps:
//   - state from core/state.js
//   - escapeHtml from core/utils.js
//   - normalizeMarginsPath, normalizePrimaryTypeValue,
//     entityPinnedBody, setEntityPrimaryTypeBody from core/wiki.js
//   - record/predicate/label helpers from core/entities.js

import { state } from "../core/state.js";
import { escapeHtml } from "../core/utils.js";
import {
  entityPinnedBody,
  normalizeMarginsPath,
  normalizePrimaryTypeValue,
  setEntityPrimaryTypeBody
} from "../core/wiki.js";
import {
  CANONICAL_ENTITY_TYPES,
  ENTITY_RECENT_PAGE_SIZE,
  entityHasPinnedSignal,
  entityRecord,
  entityRecordsFromFileMap,
  entityTagFacets,
  entityTypeDisplayLabel,
  entityTypeFacets,
  entityTypePickerOptions,
  entityVibeClass,
  isEntityActiveThisWeek
} from "../core/entities.js";

// ---------------------------------------------------------------------
// Host-supplied wiring (DOM + callbacks)
// ---------------------------------------------------------------------

let els = null;
let callbacks = {};

export function initEntitiesView(deps) {
  els = deps.els;
  callbacks = deps.callbacks || {};
}

// ---------------------------------------------------------------------
// Top-level render entry
// ---------------------------------------------------------------------

export function renderEntities(fileMap = state.currentFileMap) {
  if (!els || !els.entityBrowser) return;
  const records = entityRecordsFromFileMap(fileMap || new Map());
  state.entityFileMap = records.length ? new Map(fileMap || []) : null;
  state.entityTypeOptions = entityTypePickerOptions(records);
  if (state.entityTypePickerPath && !records.some((record) => record.path === state.entityTypePickerPath)) {
    state.entityTypePickerPath = "";
  }
  syncEntityRecentSource(records);
  syncEntityFilter(records);
  renderEntitySummary(records);
  renderEntityFilters(records);

  if (records.length === 0) {
    if (els.entityControls) els.entityControls.hidden = true;
    els.entityBrowser.className = "entity-empty-state";
    els.entityBrowser.innerHTML = `
      <div class="empty-icon" aria-hidden="true"></div>
      <h3>No entities loaded</h3>
      <p>Open a local vault or process a source. Margins will only show entities backed by real vault files.</p>
    `;
    return;
  }

  if (els.entityControls) els.entityControls.hidden = false;
  const filteredRecords = filterEntityRecords(records);
  if (filteredRecords.length === 0) {
    els.entityBrowser.className = "entity-empty-state";
    els.entityBrowser.innerHTML = `
      <div class="empty-icon" aria-hidden="true"></div>
      <h3>No matching entities</h3>
      <p>Try a different search, type, or wiki tag.</p>
    `;
    return;
  }

  els.entityBrowser.className = "entity-board";
  els.entityBrowser.innerHTML = renderEntitySections(filteredRecords);
}

// ---------------------------------------------------------------------
// Section + card rendering
// ---------------------------------------------------------------------

function renderEntitySections(records) {
  const query = String(state.entityQuery || "").trim();
  const filtered = query || state.entityFilterKind !== "all";
  if (filtered) {
    return `
      <section class="entity-section" data-entity-section="results">
        ${renderEntitySectionHead("Results", `${records.length} shown`)}
        <div class="entity-grid">${records.map(renderEntityCard).join("")}</div>
      </section>
    `;
  }

  const pinned = records.filter(entityHasPinnedSignal).slice(0, 6);
  const pinnedPaths = new Set(pinned.map((record) => record.path));
  const recent = records.filter((record) => !pinnedPaths.has(record.path));
  const visibleRecentCount = visibleEntityRecentCount(recent.length);
  const visibleRecent = recent.slice(0, visibleRecentCount);
  const sections = [];
  if (pinned.length) {
    sections.push(`
      <section class="entity-section" data-entity-section="pinned">
        ${renderEntitySectionHead("Pinned")}
        <div class="entity-grid">${pinned.map(renderEntityCard).join("")}</div>
      </section>
    `);
  }
  if (recent.length) {
    const actionLabel = recent.length > visibleRecentCount ? `${visibleRecentCount} of ${recent.length}` : "";
    sections.push(`
      <section class="entity-section" data-entity-section="recent">
        ${renderEntitySectionHead("Recently Active", actionLabel)}
        <div class="entity-grid">${visibleRecent.map(renderEntityCard).join("")}</div>
        ${renderEntityRecentActions(visibleRecentCount, recent.length)}
      </section>
    `);
  }
  return sections.join("");
}

function renderEntityRecentActions(visibleCount, totalCount) {
  if (visibleCount >= totalCount) return "";
  const remaining = totalCount - visibleCount;
  const nextCount = Math.min(ENTITY_RECENT_PAGE_SIZE, remaining);
  const showMoreLabel = remaining > ENTITY_RECENT_PAGE_SIZE ? `Show ${nextCount} more` : `Show remaining ${remaining}`;
  return `
    <div class="entity-section-actions">
      <button class="entity-list-button primary" type="button" data-entity-list-action="show-more-recent" data-entity-recent-total="${escapeHtml(String(totalCount))}">
        ${escapeHtml(showMoreLabel)}
      </button>
      <button class="entity-list-button" type="button" data-entity-list-action="show-all-recent" data-entity-recent-total="${escapeHtml(String(totalCount))}">
        Show all ${escapeHtml(String(totalCount))}
      </button>
    </div>
  `;
}

function renderEntitySectionHead(title, action = "") {
  return `
    <div class="entity-section-head">
      <h3>${escapeHtml(title)}</h3>
      ${action ? `<span>${escapeHtml(action)}</span>` : ""}
    </div>
  `;
}

function renderEntityCard(record) {
  const pinned = entityHasPinnedSignal(record);
  const pinAction = pinned ? "Unpin" : "Pin";
  const pickerOpen = state.entityTypePickerPath === record.path;
  return `
    <article class="entity-card" role="button" tabindex="0" data-entity-path="${escapeHtml(record.path)}">
      <div class="entity-card-top">
        <span class="entity-vibe ${escapeHtml(entityVibeClass(record))} t-${escapeHtml(normalizePrimaryTypeValue(record.typeLabel) || "concept")}"></span>
        <strong>${escapeHtml(record.title)}</strong>
        <button class="entity-pin-button ${pinned ? "active" : ""}" type="button" data-entity-pin-path="${escapeHtml(record.path)}" aria-pressed="${pinned ? "true" : "false"}" aria-label="${escapeHtml(`${pinAction} ${record.title}`)}" title="${escapeHtml(pinAction)}">
          <span aria-hidden="true">${escapeHtml(pinned ? "Pinned" : "Pin")}</span>
        </button>
        <button class="type-tag entity-type-chip ${pickerOpen ? "active" : ""}" type="button" data-entity-type-open="${escapeHtml(record.path)}" aria-expanded="${pickerOpen ? "true" : "false"}" aria-label="${escapeHtml(`Change type for ${record.title}. Current type ${record.typeLabel}`)}">${escapeHtml(record.typeLabel)}</button>
      </div>
      ${pickerOpen ? renderEntityTypePicker(record) : ""}
      ${record.meta ? `<div class="entity-card-meta-line">${escapeHtml(record.meta)}</div>` : ""}
      <p class="entity-card-summary">${escapeHtml(record.summary || "No summary yet.")}</p>
      ${record.nextAction ? `<div class="entity-card-next"><span>Next:</span> ${escapeHtml(record.nextAction)}</div>` : ""}
    </article>
  `;
}

function renderEntityTypePicker(record) {
  const options = state.entityTypeOptions?.length ? state.entityTypeOptions : entityTypePickerOptions([record]);
  return `
    <div class="entity-type-picker" data-entity-type-picker-path="${escapeHtml(record.path)}">
      <div class="entity-type-picker-head">
        <span>Set primary type</span>
        <button type="button" data-entity-type-close="${escapeHtml(record.path)}" aria-label="Close type picker">×</button>
      </div>
      <div class="entity-type-custom-row">
        <input data-entity-type-custom-input="${escapeHtml(record.path)}" type="text" placeholder="Type custom..." autocomplete="off">
        <button type="button" data-entity-type-custom="${escapeHtml(record.path)}">Use</button>
      </div>
      <div class="entity-type-option-list" role="listbox" aria-label="Entity type options">
        ${options.map((option) => `
          <button class="entity-type-option ${normalizePrimaryTypeValue(record.typeLabel) === option.value ? "selected" : ""}" type="button" data-entity-type-path="${escapeHtml(record.path)}" data-entity-type-value="${escapeHtml(option.value)}">
            <span>${escapeHtml(option.label)}</span>
            <span>${escapeHtml(String(option.count))}</span>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderEntitySummary(records) {
  if (!els.entityMeta) return;
  if (records.length === 0) {
    els.entityMeta.textContent = "People, projects, companies, and ideas from the connected vault.";
    return;
  }
  const activeThisWeek = records.filter((record) => isEntityActiveThisWeek(record.lastTouch || record.updated)).length;
  const pinned = records.filter((record) => entityHasPinnedSignal(record)).length;
  els.entityMeta.textContent = [
    `${records.length} in your brain`,
    `${activeThisWeek} active this week`,
    `${pinned} pinned`
  ].join(" · ");
}

// ---------------------------------------------------------------------
// Filter sync + paging
// ---------------------------------------------------------------------

function syncEntityFilter(records) {
  if (state.entityFilterKind === "all") return;
  const stillAvailable = state.entityFilterKind === "type"
    ? records.some((record) => record.typeLabel === state.entityFilterValue)
    : records.some((record) => record.filterTags.includes(state.entityFilterValue));
  if (stillAvailable) return;
  state.entityFilterKind = "all";
  state.entityFilterValue = "";
}

function syncEntityRecentSource(records) {
  const sourceKey = records.map((record) => record.path).join("\n");
  if (sourceKey === state.entityRecentSourceKey) return;
  state.entityRecentSourceKey = sourceKey;
  resetEntityRecentLimit();
}

export function resetEntityRecentLimit() {
  state.entityRecentVisibleCount = ENTITY_RECENT_PAGE_SIZE;
}

function visibleEntityRecentCount(totalCount) {
  if (totalCount <= ENTITY_RECENT_PAGE_SIZE) return totalCount;
  const requested = Math.max(
    ENTITY_RECENT_PAGE_SIZE,
    Number(state.entityRecentVisibleCount) || ENTITY_RECENT_PAGE_SIZE
  );
  state.entityRecentVisibleCount = Math.min(requested, totalCount);
  return state.entityRecentVisibleCount;
}

function renderEntityFilters(records) {
  if (els.entitySearch && els.entitySearch.value !== state.entityQuery) {
    els.entitySearch.value = state.entityQuery;
  }
  if (records.length === 0) {
    if (els.entityTypeFilters) els.entityTypeFilters.innerHTML = "";
    if (els.entityTagFilters) els.entityTagFilters.innerHTML = "";
    return;
  }
  if (els.entityTypeFilters) {
    const typeFacets = entityTypeFacets(records);
    els.entityTypeFilters.innerHTML = typeFacets.map((facet) => renderEntityChip(facet)).join("");
  }
  if (els.entityTagFilters) {
    const tagFacets = entityTagFacets(records);
    els.entityTagFilters.hidden = tagFacets.length === 0;
    els.entityTagFilters.innerHTML = tagFacets.map((facet) => renderEntityChip(facet)).join("");
  }
}

function renderEntityChip(facet) {
  const active = isEntityFilterActive(facet.kind, facet.value);
  return `
    <button class="entity-chip ${active ? "active" : ""}" type="button" data-entity-filter-kind="${escapeHtml(facet.kind)}" data-entity-filter-value="${escapeHtml(facet.value)}" aria-pressed="${active ? "true" : "false"}">
      <span>${escapeHtml(facet.label)}</span>
      <span>${escapeHtml(String(facet.count))}</span>
    </button>
  `;
}

function isEntityFilterActive(kind, value) {
  if (kind === "all") return state.entityFilterKind === "all";
  return state.entityFilterKind === kind && state.entityFilterValue === value;
}

function filterEntityRecords(records) {
  const query = String(state.entityQuery || "").trim().toLowerCase();
  return records.filter((record) => {
    if (state.entityFilterKind === "type" && record.typeLabel !== state.entityFilterValue) return false;
    if (state.entityFilterKind === "tag" && !record.filterTags.includes(state.entityFilterValue)) return false;
    if (!query) return true;
    const searchable = [
      record.title,
      record.summary,
      record.typeLabel,
      record.bucketLabel,
      ...record.tags
    ].join(" ").toLowerCase();
    return searchable.includes(query);
  });
}

export function activeEntityFileMap() {
  return state.currentFileMap || state.entityFileMap || new Map();
}

// ---------------------------------------------------------------------
// Event handlers (wired by host on els.entityBrowser etc.)
// ---------------------------------------------------------------------

export function handleEntityFilterClick(event) {
  const button = event.target.closest("[data-entity-filter-kind]");
  if (!button) return;
  state.entityFilterKind = button.dataset.entityFilterKind || "all";
  state.entityFilterValue = button.dataset.entityFilterValue || "";
  if (state.entityFilterKind === "all") state.entityFilterValue = "";
  resetEntityRecentLimit();
  renderEntities(activeEntityFileMap());
}

export async function handleEntityBrowserActionClick(event) {
  const typeCloseButton = event.target.closest("[data-entity-type-close]");
  if (typeCloseButton) {
    event.preventDefault();
    event.stopPropagation();
    state.entityTypePickerPath = "";
    renderEntities(activeEntityFileMap());
    return;
  }

  const typeChoiceButton = event.target.closest("[data-entity-type-value]");
  if (typeChoiceButton) {
    event.preventDefault();
    event.stopPropagation();
    await callbacks.withBusyOperation?.("entity type", () => setEntityPrimaryType(
      typeChoiceButton.dataset.entityTypePath,
      typeChoiceButton.dataset.entityTypeValue
    ));
    return;
  }

  const typeCustomButton = event.target.closest("[data-entity-type-custom]");
  if (typeCustomButton) {
    event.preventDefault();
    event.stopPropagation();
    const picker = typeCustomButton.closest(".entity-type-picker");
    const input = picker?.querySelector("[data-entity-type-custom-input]");
    await callbacks.withBusyOperation?.("entity type", () => setEntityPrimaryType(
      typeCustomButton.dataset.entityTypeCustom,
      input?.value || ""
    ));
    return;
  }

  const typeOpenButton = event.target.closest("[data-entity-type-open]");
  if (typeOpenButton) {
    event.preventDefault();
    event.stopPropagation();
    const path = normalizeMarginsPath(typeOpenButton.dataset.entityTypeOpen || "");
    state.entityTypePickerPath = state.entityTypePickerPath === path ? "" : path;
    renderEntities(activeEntityFileMap());
    if (state.entityTypePickerPath) requestAnimationFrame(() => {
      els.entityBrowser?.querySelector(".entity-type-picker input")?.focus({ preventScroll: true });
    });
    return;
  }

  if (event.target.closest(".entity-type-picker")) {
    event.stopPropagation();
    return;
  }

  const button = event.target.closest("[data-entity-list-action]");
  if (button) {
    event.preventDefault();
    event.stopPropagation();
    const totalCount = Math.max(0, Number(button.dataset.entityRecentTotal) || 0);
    if (button.dataset.entityListAction === "show-more-recent") {
      state.entityRecentVisibleCount = Math.min(
        totalCount,
        Math.max(ENTITY_RECENT_PAGE_SIZE, state.entityRecentVisibleCount) + ENTITY_RECENT_PAGE_SIZE
      );
    } else if (button.dataset.entityListAction === "show-all-recent") {
      state.entityRecentVisibleCount = totalCount;
    }
    renderEntities(activeEntityFileMap());
    return;
  }

  const pinButton = event.target.closest("[data-entity-pin-path]");
  if (pinButton) {
    event.preventDefault();
    event.stopPropagation();
    await callbacks.withBusyOperation?.("entity pin", () => toggleEntityPin(pinButton.dataset.entityPinPath));
    return;
  }

  const card = event.target.closest("[data-entity-path]");
  if (card && els.entityBrowser?.contains(card)) {
    callbacks.activateTab?.("wiki");
    callbacks.selectVaultPath?.(card.dataset.entityPath);
  }
}

export function handleEntityBrowserKeydown(event) {
  if (!["Enter", " "].includes(event.key)) return;
  if (event.target.closest("button, input, textarea, select, a")) return;
  const card = event.target.closest("[data-entity-path]");
  if (!card || !els.entityBrowser?.contains(card)) return;
  event.preventDefault();
  callbacks.activateTab?.("wiki");
  callbacks.selectVaultPath?.(card.dataset.entityPath);
}

// ---------------------------------------------------------------------
// State mutators (write-through to vault)
// ---------------------------------------------------------------------

async function toggleEntityPin(path) {
  const normalizedPath = normalizeMarginsPath(path);
  if (!normalizedPath || !state.currentFileMap?.has(normalizedPath)) return false;
  if (!state.vaultHandle) {
    if (els?.stats) els.stats.textContent = "Open a vault before pinning entities.";
    return false;
  }

  const currentBody = state.currentFileMap.get(normalizedPath);
  const record = entityRecord(normalizedPath, currentBody);
  if (!record) return false;
  const shouldPin = !entityHasPinnedSignal(record);
  const nextBody = entityPinnedBody(currentBody, shouldPin);
  if (nextBody === currentBody) return false;

  const granted = await callbacks.requestVaultPermission?.(state.vaultHandle);
  if (!granted) {
    callbacks.updateVaultStatus?.("Pinning needs vault write permission.");
    return false;
  }

  await callbacks.writeTextFile?.(state.vaultHandle, normalizedPath, nextBody);
  state.currentFileMap.set(normalizedPath, nextBody);
  state.loadedFileMap.set(normalizedPath, nextBody);
  if (state.selectedPath === normalizedPath) {
    callbacks.setDocumentHeader?.(normalizedPath, nextBody, { kind: state.selectedKind || "wiki", readOnly: false });
    callbacks.setDocBody?.(nextBody, { readOnly: false });
  }
  renderEntities(activeEntityFileMap());
  callbacks.renderWikiFiles?.(state.currentFileMap);
  if (callbacks.drawGraph && callbacks.graphFromFileMap) {
    callbacks.drawGraph(callbacks.graphFromFileMap(state.currentFileMap));
  }
  if (els?.stats) els.stats.textContent = `${shouldPin ? "Pinned" : "Unpinned"} ${record.title}`;
  callbacks.updateSaveButtonState?.();
  return true;
}

async function setEntityPrimaryType(path, rawType) {
  const normalizedPath = normalizeMarginsPath(path);
  const primaryType = normalizePrimaryTypeValue(rawType);
  if (!normalizedPath || !primaryType || !state.currentFileMap?.has(normalizedPath)) return false;

  const currentBody = state.currentFileMap.get(normalizedPath);
  const record = entityRecord(normalizedPath, currentBody);
  if (!record) return false;
  const nextBody = setEntityPrimaryTypeBody(currentBody, primaryType);
  if (nextBody === currentBody) {
    state.entityTypePickerPath = "";
    renderEntities(activeEntityFileMap());
    return false;
  }

  if (state.vaultHandle) {
    const granted = await callbacks.requestVaultPermission?.(state.vaultHandle);
    if (!granted) {
      callbacks.updateVaultStatus?.("Changing entity type needs vault write permission.");
      return false;
    }
    await callbacks.writeTextFile?.(state.vaultHandle, normalizedPath, nextBody);
    state.loadedFileMap.set(normalizedPath, nextBody);
    state.hasUnsavedEdits = false;
  } else {
    state.hasUnsavedEdits = true;
  }

  state.currentFileMap.set(normalizedPath, nextBody);
  if (state.selectedPath === normalizedPath) {
    callbacks.setDocumentHeader?.(normalizedPath, nextBody, { kind: state.selectedKind || "wiki", readOnly: false });
    callbacks.setDocBody?.(nextBody, { readOnly: false });
  }
  state.entityTypePickerPath = "";
  renderEntities(activeEntityFileMap());
  callbacks.renderWikiFiles?.(state.currentFileMap);
  if (callbacks.drawGraph && callbacks.graphFromFileMap) {
    callbacks.drawGraph(callbacks.graphFromFileMap(state.currentFileMap));
  }
  if (els?.stats) els.stats.textContent = `Set ${record.title} to ${entityTypeDisplayLabel(primaryType)}.`;
  callbacks.updateSaveButtonState?.();
  return true;
}

// CANONICAL_ENTITY_TYPES is re-exported so prompt callers (tests) can
// reference the same canonical list without importing core/entities.
export { CANONICAL_ENTITY_TYPES };
