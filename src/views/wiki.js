// Wiki view ("Files" tab) — vault file tree + ingest stat panel.
//
// Phase 8 of the module-split refactor. Pulls the file-tree rendering
// and per-file selection logic out of app.js. The view does NOT own:
//   - The document pane (header/body/save) — those helpers stay in
//     app.js since they're shared with raw-source editing flows.
//   - Activity / Dream / Entities renders — those are siblings, not
//     wiki concerns. They piggy-back on renderVaultTree's render
//     trigger via callbacks set during init.
//
// External shape required from the host (set via initWikiView):
//   els: { vaultTree, vaultTreeCount, vaultSearch, wikiTree, docBody,
//          docSaveBtn }
//   callbacks: {
//     renderRecentActivity, renderDream, renderEntities,
//     activeActivityFileMap, ingestionStats,
//     setDocumentHeader, setDocBody, updateSaveButtonState,
//     pathKind, rawFileForPath, rawSourceOutputPath
//   }
//
// `selectVaultPath` is exported so non-wiki call sites (graph onOpenNode,
// entity card click handlers, dream open-action flows) can reuse it.

import { state } from "../core/state.js";
import { escapeHtml, formatStatNumber } from "../core/utils.js";
import { basename, normalizeMarginsPath } from "../core/wiki.js";

// ---------------------------------------------------------------------
// Operating-files registry — paths that live at the vault root and are
// always shown above raw/ in the file tree.
// ---------------------------------------------------------------------

const ROOT_GENERATED_TEXT_FILES = new Set(["CLAUDE.md", "operator-manual.md", "query-cookbook.md"]);

// ---------------------------------------------------------------------
// Host-supplied wiring (DOM + callbacks)
// ---------------------------------------------------------------------

let els = null;
let callbacks = {};

export function initWikiView(deps) {
  els = deps.els;
  callbacks = deps.callbacks || {};
}

// ---------------------------------------------------------------------
// Stat panel (sidebar)
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

function sidebarFolderOrder(name) {
  return {
    raw: 0,
    raw_sources: 1,
    wiki: 2,
    commands: 3,
    agents: 4
  }[name] ?? 4;
}

// ---------------------------------------------------------------------
// File tree render entry
// ---------------------------------------------------------------------

export function renderWikiFiles(fileMap) {
  if (!els) return;
  const query = (els.vaultSearch?.value || "").trim().toLowerCase();
  const entries = vaultBrowserEntries(fileMap || new Map()).filter((entry) => (
    !query || entry.path.toLowerCase().includes(query) || entry.body.toLowerCase().includes(query)
  ));
  if (els.vaultTreeCount) els.vaultTreeCount.textContent = fileCountLabel(entries.length);

  if (entries.length === 0) {
    els.wikiTree.className = "tree-list empty";
    els.wikiTree.textContent = "Open a vault or add documents to browse source files and wiki notes.";
    callbacks.setDocumentHeader?.(null, "", { title: "No file selected", meta: "No file selected" });
    callbacks.setDocBody?.("Open a source file or wiki note, then choose a file.", { readOnly: true });
    if (els.docSaveBtn) els.docSaveBtn.disabled = true;
    return;
  }

  const hasSelectedEntry = state.selectedPath && entries.some((entry) => entry.path === state.selectedPath);
  if (!hasSelectedEntry && !query) {
    state.selectedPath = defaultVaultBrowserPath(entries);
    state.selectedKind = state.selectedPath ? callbacks.pathKind?.(state.selectedPath) || "" : "";
  }

  els.wikiTree.className = "vault-file-browser";
  els.wikiTree.innerHTML = renderVaultFolderTree(entries);

  els.wikiTree.querySelectorAll(".vault-file").forEach((item) => {
    item.addEventListener("click", () => {
      selectVaultPath(item.dataset.path);
    });
  });

  if (state.selectedPath && entries.some((entry) => entry.path === state.selectedPath)) {
    selectVaultPath(state.selectedPath, { preserveFocus: true });
    return;
  }

  state.selectedPath = null;
  state.selectedKind = "";
  callbacks.setDocumentHeader?.(null, "", { title: "No file selected", meta: "No file selected" });
  callbacks.setDocBody?.("Choose a source file or wiki note.", { readOnly: true });
  if (els.docSaveBtn) els.docSaveBtn.disabled = true;
}

function defaultVaultBrowserPath(entries = []) {
  const paths = entries.map((entry) => entry.path);
  return paths.find((path) => path === "CLAUDE.md")
    || paths.find((path) => path === "wiki/index.md")
    || paths.find((path) => /^wiki\/[^/]+\/index\.md$/i.test(path))
    || paths.find((path) => path.startsWith("wiki/") && path.endsWith(".md"))
    || paths[0]
    || "";
}

function vaultBrowserEntries(fileMap) {
  const allSourceFiles = callbacks.allSourceFiles?.() || [];
  const rawSourceOutputPath = callbacks.rawSourceOutputPath || ((name) => `raw/${name}`);
  const rawEntries = allSourceFiles.map((file) => ({
    path: rawSourceOutputPath(file.name),
    body: file.text || (file.type === "pdf" ? "PDF source preserved in raw/." : "Original file preserved in raw/."),
    kind: "raw",
    editable: (file.type !== "pdf" && file.type !== "attachment") || !!file.text
  }));
  const wikiEntries = [...fileMap.entries()]
    .filter(([path]) => path.startsWith("wiki/") && !path.startsWith("wiki/.margins/"))
    .map(([path, body]) => ({
      path: normalizeMarginsPath(path),
      body,
      kind: "wiki",
      editable: true
    }));
  const operatingEntries = [...fileMap.entries()]
    .filter(([path]) => isOperatingBrowserPath(path))
    .map(([path, body]) => ({
      path: normalizeMarginsPath(path),
      body,
      kind: "operating",
      editable: true
    }));
  return [...operatingEntries, ...rawEntries, ...wikiEntries].sort((left, right) => (
    browserPathRank(left.path) - browserPathRank(right.path) || left.path.localeCompare(right.path)
  ));
}

function isOperatingBrowserPath(path) {
  const normalizedPath = normalizeMarginsPath(path);
  return ROOT_GENERATED_TEXT_FILES.has(normalizedPath) ||
    normalizedPath.startsWith("commands/") ||
    normalizedPath.startsWith("agents/");
}

function browserPathRank(path) {
  const normalizedPath = normalizeMarginsPath(path);
  if (ROOT_GENERATED_TEXT_FILES.has(normalizedPath)) return 0;
  if (normalizedPath.startsWith("commands/") || normalizedPath.startsWith("agents/")) return 1;
  if (normalizedPath.startsWith("raw/")) return 2;
  if (normalizedPath.startsWith("wiki/")) return 3;
  return 4;
}

// ---------------------------------------------------------------------
// Folder/file rendering
// ---------------------------------------------------------------------

function renderVaultFolderTree(entries) {
  const root = { folders: new Map(), files: [] };
  for (const entry of entries) {
    const parts = entry.path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), files: [] });
      node = node.folders.get(part);
    }
    node.files.push(entry);
  }
  const rootFiles = renderVaultFiles(root.files, 0);
  const folders = [...root.folders.entries()]
    .sort(([left], [right]) => sidebarFolderOrder(left) - sidebarFolderOrder(right) || left.localeCompare(right))
    .map(([name, node]) => renderVaultFolder(name, node, 0))
    .join("");
  return `${rootFiles}${folders}`;
}

function renderVaultFolder(name, node, depth, parentPath = "") {
  const folderPath = parentPath ? `${parentPath}/${name}` : name;
  const hasQuery = !!(els?.vaultSearch?.value || "").trim();
  const shouldOpen = hasQuery || state.selectedPath?.startsWith(`${folderPath}/`);
  const folders = [...node.folders.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([childName, childNode]) => renderVaultFolder(childName, childNode, depth + 1, folderPath))
    .join("");
  const files = node.files
    .sort((left, right) => browserPathRank(left.path) - browserPathRank(right.path) || left.path.localeCompare(right.path));
  return `
    <details class="vault-folder" style="--depth: ${depth}"${shouldOpen ? " open" : ""}>
      <summary><span>${escapeHtml(name)}</span></summary>
      ${folders}${renderVaultFiles(files, depth + 1)}
    </details>
  `;
}

function renderVaultFiles(files, depth) {
  return files.map((file) => `
    <button class="vault-file" type="button" data-path="${escapeHtml(file.path)}" style="--depth: ${depth}">
      <span>${escapeHtml(basename(file.path))}</span>
    </button>
  `).join("");
}

function fileCountLabel(count) {
  return `${count} file${count === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------
// File selection (exported — used by graph onOpenNode + entity click +
// dream open-action + inline activity links)
// ---------------------------------------------------------------------

export function selectVaultPath(path, options = {}) {
  if (!els) return false;
  const normalizedPath = normalizeMarginsPath(path);
  const rawFileForPath = callbacks.rawFileForPath;
  const rawSourceOutputPath = callbacks.rawSourceOutputPath || ((name) => `raw/${name}`);
  const rawFile = rawFileForPath?.(normalizedPath);
  if (rawFile) {
    state.selectedPath = rawSourceOutputPath(rawFile.name);
    state.selectedKind = "raw";
    const body = rawFile.text || (rawFile.type === "pdf" ? "PDF source preserved in raw/." : "Original file preserved in raw/.");
    const readOnly = (rawFile.type === "pdf" || rawFile.type === "attachment") && !rawFile.text;
    callbacks.setDocumentHeader?.(state.selectedPath, body, { kind: "raw", readOnly });
    callbacks.setDocBody?.(body, { readOnly });
    updateSelectedFileState(options);
    return true;
  }

  if (state.currentFileMap?.has(normalizedPath)) {
    state.selectedPath = normalizedPath;
    state.selectedKind = normalizedPath.startsWith("wiki/") ? "wiki" : "system";
    const body = state.currentFileMap.get(normalizedPath);
    callbacks.setDocumentHeader?.(normalizedPath, body, { kind: state.selectedKind, readOnly: false });
    callbacks.setDocBody?.(body, { readOnly: false });
    updateSelectedFileState(options);
    return true;
  }

  return false;
}

function updateSelectedFileState(options = {}) {
  els?.wikiTree?.querySelectorAll(".vault-file").forEach((item) => {
    item.classList.toggle("active", item.dataset.path === state.selectedPath);
  });
  if (!options.preserveFocus && document.activeElement !== els?.docBody) {
    els?.docBody?.focus({ preventScroll: true });
  }
  callbacks.updateSaveButtonState?.();
}
