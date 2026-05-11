// File System Access layer — vault lifecycle, scaffolding, I/O, and
// raw-source path mapping.
//
// Phase 10 of the module-split refactor. Pulls vault-domain helpers out
// of app.js. Two surfaces:
//
//   1. Pure helpers — path normalization, FS Access primitives, vault
//      scaffolding/IO. Take a rootHandle as their first argument and
//      do not touch app-level state. Importable directly.
//
//   2. Orchestration helpers — createVault, openVault, saveCurrentVault,
//      etc. Read app-level state and dispatch to render callbacks. Wired
//      via initVaultModule({ els, callbacks, helpers }).
//
// CRITICAL — File System Access permission round-trip is fragile:
//   - requestVaultPermission and showDirectoryPicker MUST be the first
//     awaited call inside a click handler. Chrome treats post-await as
//     no-user-activation. We do NOT wrap createVault/openVault picker
//     calls in withBusyOperation before the picker fires.
//   - queryVaultPermission can be called without user gesture (used
//     during restoreRememberedVault for pre-flight permission probe).
//   - saveVaultHandle is fire-and-forget — keep .catch(() => {}).

import { state } from "./state.js";
import {
  basename,
  frontmatterFields,
  frontmatterList,
  isBucketOverviewPath,
  isContextWikiPagePath,
  isFolderIndexPath,
  isReadableSourceTextPath,
  normalizeMarginsPath
} from "./wiki.js";
import { hasFileSystemAccess, loadVaultHandle, saveVaultHandle } from "../vaultHandleStore.js";

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

export const RAW_SOURCE_DIR = "raw";
export const LEGACY_RAW_SOURCE_DIR = "raw_sources";

const ROOT_GENERATED_TEXT_FILES = new Set(["CLAUDE.md", "operator-manual.md", "query-cookbook.md"]);
const PRESERVED_GENERATED_TEXT_FILES = new Set(["wiki/.margins/export-summary.json"]);

// ---------------------------------------------------------------------
// Host-supplied wiring (DOM + callbacks + helpers)
// ---------------------------------------------------------------------

let els = null;
let callbacks = {};
let helpers = {};

export function initVaultModule(deps) {
  els = deps.els;
  callbacks = deps.callbacks || {};
  helpers = deps.helpers || {};
}

// ---------------------------------------------------------------------
// Path normalization helpers
// ---------------------------------------------------------------------

export function safeRelativePath(path) {
  return String(path)
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => part.replace(/[<>:"|?*\u0000-\u001F]/g, "-"))
    .join("/");
}

export function rawSourceOutputPath(path) {
  const safePath = rawSourceRelativeName(path);
  return `${RAW_SOURCE_DIR}/${safePath}`;
}

export function legacyRawSourceOutputPath(path) {
  const safePath = rawSourceRelativeName(path);
  return `${LEGACY_RAW_SOURCE_DIR}/${safePath}`;
}

export function rawSourceCandidatePaths(path) {
  return [
    rawSourceOutputPath(path),
    legacyRawSourceOutputPath(path)
  ];
}

export function rawSourceRelativeName(path) {
  return safeRelativePath(path)
    .replace(new RegExp(`^${RAW_SOURCE_DIR}/`), "")
    .replace(new RegExp(`^${LEGACY_RAW_SOURCE_DIR}/`), "");
}

export function isRawSourcePath(path) {
  const normalized = normalizeMarginsPath(path);
  return normalized.startsWith(`${RAW_SOURCE_DIR}/`) || normalized.startsWith(`${LEGACY_RAW_SOURCE_DIR}/`);
}

export function isVaultTextPath(path) {
  return /\.(md|txt|json|jsonl)$/i.test(path);
}

export function normalizeVaultOutputPath(path) {
  return safeRelativePath(normalizeMarginsPath(path));
}

export function isDeletableGeneratedTextPath(path) {
  const normalizedPath = normalizeVaultOutputPath(path);
  if (!normalizedPath || PRESERVED_GENERATED_TEXT_FILES.has(normalizedPath)) return false;
  return (
    normalizedPath.startsWith("wiki/") ||
    normalizedPath.startsWith("commands/") ||
    normalizedPath.startsWith("agents/") ||
    ROOT_GENERATED_TEXT_FILES.has(normalizedPath)
  );
}

export function isMissingEntryError(error) {
  return error?.name === "NotFoundError" || /missing|not found/i.test(error?.message || "");
}

// ---------------------------------------------------------------------
// FS Access primitives — directory/file handle helpers
// ---------------------------------------------------------------------

export async function ensureDirectory(rootHandle, path) {
  const parts = safeRelativePath(path).split("/").filter(Boolean);
  let dir = rootHandle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}

export async function directoryHandleForPath(rootHandle, path, create = true) {
  const parts = safeRelativePath(path).split("/").filter(Boolean);
  let dir = rootHandle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

export async function fileHandleForPath(rootHandle, path, create = true) {
  const parts = safeRelativePath(path).split("/").filter(Boolean);
  const fileName = parts.pop();
  let dir = rootHandle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir.getFileHandle(fileName || "untitled.md", { create });
}

export async function readTextHandle(fileHandle) {
  const file = await fileHandle.getFile();
  return file.text();
}

export async function writeTextFile(rootHandle, path, body) {
  const fileHandle = await fileHandleForPath(rootHandle, path);
  const writable = await fileHandle.createWritable();
  await writable.write(body);
  await writable.close();
}

export async function writeTextFileIfMissing(rootHandle, path, body) {
  try {
    await fileHandleForPath(rootHandle, path, false);
  } catch {
    await writeTextFile(rootHandle, path, body);
  }
}

export async function writeBlobFile(rootHandle, path, blob) {
  const fileHandle = await fileHandleForPath(rootHandle, path);
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

// ---------------------------------------------------------------------
// Vault scaffolding + read
// ---------------------------------------------------------------------

export async function scaffoldVault(rootHandle, plan = null) {
  await ensureDirectory(rootHandle, RAW_SOURCE_DIR);
  await ensureDirectory(rootHandle, "wiki/sources");
  await ensureDirectory(rootHandle, "wiki/concepts");
  await ensureDirectory(rootHandle, "wiki/entities");
  await ensureDirectory(rootHandle, "wiki/synthesis");
  await ensureDirectory(rootHandle, "wiki/_templates");
  await ensureDirectory(rootHandle, "commands");
  await ensureDirectory(rootHandle, "agents");
  await ensureDirectory(rootHandle, "wiki/.margins");

  const extraFolders = Array.isArray(plan?.folders) ? plan.folders : [];
  for (const folder of extraFolders) {
    if (typeof folder === "string" && folder.trim()) {
      await ensureDirectory(rootHandle, folder.trim());
    }
  }

  await writeTextFileIfMissing(rootHandle, `${RAW_SOURCE_DIR}/README.md`, `# Original Sources

Drop original source files here. Margins treats this folder as evidence and writes generated knowledge into wiki/.
`);
  await writeTextFileIfMissing(rootHandle, "CLAUDE.md", "# CLAUDE.md\n\nMargins will write the agent operating skeleton here.\n");
  await writeTextFileIfMissing(rootHandle, "operator-manual.md", "# Operator Manual\n\nMargins will write model operating instructions here.\n");
  await writeTextFileIfMissing(rootHandle, "query-cookbook.md", "# Query Cookbook\n\nMargins will write query recipes here.\n");

  const seedFiles = plan?.seedFiles && typeof plan.seedFiles === "object" ? plan.seedFiles : {};
  for (const [path, body] of Object.entries(seedFiles)) {
    if (typeof path === "string" && typeof body === "string") {
      await writeTextFileIfMissing(rootHandle, path, body);
    }
  }

  await writeTextFileIfMissing(rootHandle, "wiki/.margins/manifest.json", JSON.stringify({
    name: plan?.vaultName || "Margins Vault",
    template: plan?.templateId || "karpathy-original",
    version: "0.1.0",
    created_at: new Date().toISOString(),
    storage: "local-folder"
  }, null, 2));
}

export async function readVaultFileMap(rootHandle) {
  const fileMap = new Map();
  await readDirectoryTextFiles(rootHandle, ".margins", fileMap);
  await readDirectoryTextFiles(rootHandle, "wiki", fileMap);
  await readDirectoryTextFiles(rootHandle, "commands", fileMap);
  await readDirectoryTextFiles(rootHandle, "agents", fileMap);
  await readRootTextFile(rootHandle, "CLAUDE.md", fileMap);
  await readRootTextFile(rootHandle, "operator-manual.md", fileMap);
  await readRootTextFile(rootHandle, "query-cookbook.md", fileMap);
  if (fileMap.size === 0 && rootHandle?.name?.toLowerCase() === "wiki") {
    await readDirectoryTextFilesFromHandle(rootHandle, "wiki", fileMap);
  }
  return fileMap;
}

export async function readRawSourcesFromVault(rootHandle) {
  const files = [];
  await readRawSourceDirectory(rootHandle, RAW_SOURCE_DIR, files);
  if (files.length > 0) return files.sort((left, right) => left.name.localeCompare(right.name));

  const legacyFiles = [];
  await readRawSourceDirectory(rootHandle, LEGACY_RAW_SOURCE_DIR, legacyFiles);
  return legacyFiles.sort((left, right) => left.name.localeCompare(right.name));
}

export async function readDirectoryTextFiles(rootHandle, path, fileMap) {
  let dir;
  try {
    dir = await directoryHandleForPath(rootHandle, path, false);
  } catch {
    return;
  }

  await readDirectoryTextFilesFromHandle(dir, path, fileMap);
}

async function readDirectoryTextFilesFromHandle(dir, path, fileMap) {
  for await (const [name, handle] of dir.entries()) {
    const childPath = `${path}/${name}`;
    if (handle.kind === "directory") {
      await readDirectoryTextFilesFromHandle(handle, childPath, fileMap);
    } else if (isVaultTextPath(childPath)) {
      const normalizedPath = normalizeMarginsPath(childPath);
      fileMap.set(normalizedPath, await readTextHandle(handle));
    }
  }
}

export async function readRootTextFile(rootHandle, path, fileMap) {
  try {
    const fileHandle = await fileHandleForPath(rootHandle, path, false);
    fileMap.set(path, await readTextHandle(fileHandle));
  } catch {
    // Missing operating files are allowed for partially created vaults.
  }
}

export async function readRawSourceDirectory(rootHandle, path, files) {
  let dir;
  try {
    dir = await directoryHandleForPath(rootHandle, path, false);
  } catch {
    return;
  }

  for await (const [name, handle] of dir.entries()) {
    const childPath = `${path}/${name}`;
    if (name.startsWith(".")) continue;
    if (handle.kind === "directory") {
      await readRawSourceDirectory(rootHandle, childPath, files);
    } else if (name !== "README.md") {
      files.push(await rawSourceFromFileHandle(handle, rawSourceRelativeName(childPath), normalizeMarginsPath(childPath)));
    }
  }
}

export async function rawSourceFromFileHandle(fileHandle, name, rawPath = rawSourceOutputPath(name)) {
  const file = await fileHandle.getFile();
  const isPdf = /\.pdf$/i.test(name);
  const isDocx = /\.docx$/i.test(name);
  const isReadableText = isReadableSourceTextPath(name);
  const extractDocxText = helpers.extractDocxText;
  let text = "";
  let extractionStatus = "ready";
  let extractionError = "";
  let type = "text";
  if (isPdf) {
    extractionStatus = "needed";
    type = "pdf";
  } else if (isDocx) {
    type = "docx";
    try {
      text = extractDocxText ? await extractDocxText(file) : "";
      extractionStatus = text ? "extracted" : "failed";
      extractionError = text ? "" : "No readable text found in DOCX.";
    } catch (error) {
      text = "";
      extractionStatus = "failed";
      extractionError = error.message || "DOCX extraction failed.";
    }
  } else if (isReadableText) {
    try {
      text = await file.text();
    } catch {
      text = "";
      extractionStatus = "failed";
      extractionError = "Text could not be read.";
    }
  } else {
    type = "attachment";
    extractionStatus = "needed";
    extractionError = "Needs model review from the original file.";
  }
  return {
    name,
    text,
    browserFile: file,
    rawSourceHandle: fileHandle,
    rawPath,
    size: file.size,
    lastModified: file.lastModified,
    type,
    extractionStatus,
    extractionError,
    sourceScope: "vault"
  };
}

// ---------------------------------------------------------------------
// Raw-source write/delete
// ---------------------------------------------------------------------

export async function writeRawSources(rootHandle, files) {
  if (files.length === 0) {
    await writeTextFile(rootHandle, `${RAW_SOURCE_DIR}/README.md`, `# Original Sources

No original source files were loaded in the browser when this Margins folder was written.

To preserve original evidence, reload the original files in Margins before clicking "Save." Browsers clear selected file handles after refresh for security.
`);
    return 0;
  }

  let count = 0;
  for (const file of files) {
    const path = rawSourceOutputPath(file.name || `source-${count + 1}.txt`);
    if (file.browserFile) {
      await writeBlobFile(rootHandle, path, file.browserFile);
    } else {
      await writeTextFile(rootHandle, path, file.text || "");
    }
    count += 1;
  }
  return count;
}

export async function deleteRawSourceFromVault(rootHandle, fileName) {
  let deleted = false;
  for (const path of rawSourceCandidatePaths(fileName)) {
    const parts = safeRelativePath(path).split("/").filter(Boolean);
    const entryName = parts.pop();
    if (!entryName) continue;

    try {
      let dir = rootHandle;
      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create: false });
      }
      await dir.removeEntry(entryName);
      deleted = true;
    } catch {
      // The active raw/ path and the legacy raw_sources/ path are both allowed.
    }
  }
  if (!deleted) throw new Error(`${basename(fileName)} was not found in raw/.`);
}

// ---------------------------------------------------------------------
// File-map write
// ---------------------------------------------------------------------

export async function writeFileMap(rootHandle, fileMap, previousFileMap = new Map()) {
  const nextPaths = new Set([...fileMap.keys()].map(normalizeVaultOutputPath));
  for (const path of previousFileMap.keys()) {
    const normalizedPath = normalizeVaultOutputPath(path);
    if (nextPaths.has(normalizedPath) || !isDeletableGeneratedTextPath(normalizedPath)) continue;
    await deleteGeneratedTextFile(rootHandle, normalizedPath);
  }

  let count = 0;
  for (const [path, body] of fileMap.entries()) {
    await writeTextFile(rootHandle, normalizeVaultOutputPath(path), body);
    count += 1;
  }
  return count;
}

export async function deleteGeneratedTextFile(rootHandle, path) {
  const parts = normalizeVaultOutputPath(path).split("/").filter(Boolean);
  const entryName = parts.pop();
  if (!entryName) return false;

  let dir = rootHandle;
  try {
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: false });
    }
    await dir.removeEntry(entryName);
    return true;
  } catch (error) {
    if (isMissingEntryError(error)) return false;
    throw error;
  }
}

// ---------------------------------------------------------------------
// Source-mapping helpers (vault-bound)
// ---------------------------------------------------------------------

export function hasVaultWikiContent(fileMap) {
  return [...fileMap.entries()].some(([path, body]) => (
    isContextWikiPagePath(path) &&
    !isFolderIndexPath(path) &&
    !isSourceOnlyWikiPage(path, body)
  ));
}

export function isSourceOnlyWikiPage(path, body) {
  if (path === "wiki/index.md" || /^wiki\/(ingest-tracker|log|wiki-stats)\.md$/.test(path)) return true;
  if (path.startsWith("wiki/sources/") || /^wiki\/[^/]+\/source[-/]/.test(path)) return true;
  if (isBucketOverviewPath(path)) return true;
  const type = String(frontmatterFields(body).type || "").toLowerCase();
  return ["source", "log", "index", "template"].includes(type);
}

export function sourceNoteEntryForFile(file) {
  return sourceNoteEntryForFileMap(file, state.currentFileMap);
}

export function sourceNoteEntryForFileMap(file, fileMap) {
  if (!fileMap || !file?.name) return null;
  const isActivitySourcePagePath = helpers.isActivitySourcePagePath;
  if (typeof isActivitySourcePagePath !== "function") return null;
  const rawPaths = rawSourceCandidatePaths(file.name);
  for (const [path, body] of fileMap.entries()) {
    if (
      isActivitySourcePagePath(path, body) &&
      bodyReferencesRawSource(body, rawPaths)
    ) return { path, body };
  }
  return null;
}

export function bodyReferencesRawSource(body, rawPaths) {
  const text = String(body || "");
  const candidates = Array.isArray(rawPaths) ? rawPaths : [rawPaths];
  if (candidates.some((rawPath) => text.includes(rawPath))) return true;
  const fields = frontmatterFields(text);
  const frontmatterPaths = frontmatterList(fields.raw_file).map((path) => normalizeMarginsPath(path));
  return candidates.some((rawPath) => frontmatterPaths.includes(rawPath));
}

export function isRawSourceIngested(file, fileMap = state.currentFileMap) {
  return Boolean(sourceNoteEntryForFileMap(file, fileMap));
}

export function pendingRawSourcesFromVault(fileMap = state.currentFileMap, rawFiles = state.vaultFiles) {
  return rawFiles
    .filter((file) => !isRawSourceIngested(file, fileMap))
    .map((file) => ({ ...file, sourceScope: "vault" }));
}

// ---------------------------------------------------------------------
// Stale-file refresh
// ---------------------------------------------------------------------

export async function refreshRawSourceBlobFromVault(file) {
  if (!file?.name) return null;
  let handle = file.rawSourceHandle || null;
  if (!handle && state.vaultHandle) {
    for (const path of [file.rawPath, ...rawSourceCandidatePaths(file.name)].filter(Boolean)) {
      try {
        handle = await fileHandleForPath(state.vaultHandle, path, false);
        file.rawSourceHandle = handle;
        file.rawPath = path;
        break;
      } catch {
        handle = null;
      }
    }
  }
  if (!handle?.getFile) return null;
  const freshFile = await handle.getFile();
  file.browserFile = freshFile;
  file.size = freshFile.size;
  file.lastModified = freshFile.lastModified;
  return freshFile;
}

// ---------------------------------------------------------------------
// Orchestration — vault status + lifecycle
// ---------------------------------------------------------------------

export function updateVaultStatus(message) {
  if (els?.vaultStatus) els.vaultStatus.textContent = message;
}

export function setActiveVault(handle, name) {
  state.vaultHandle = handle;
  state.rememberedVaultHandle = handle;
  state.vaultName = name;
  if (els?.createVaultBtn) els.createVaultBtn.textContent = "Create vault";
  if (els?.openVaultBtn) els.openVaultBtn.textContent = "Change vault";
  callbacks.updateSaveButtonState?.();
  updateVaultStatus(name);
  saveVaultHandle(handle).catch(() => {});
  callbacks.updateWorkflowState?.();
}

export async function queryVaultPermission(handle) {
  if (!handle || typeof handle.queryPermission !== "function") return "prompt";
  try {
    return await handle.queryPermission({ mode: "readwrite" });
  } catch {
    return "prompt";
  }
}

// FS-Access permission round-trip.
//
// CRITICAL: this MUST be the first awaited call inside a click handler.
// Chrome treats post-await as no-user-activation and rejects the
// permission prompt. Callers must NOT wrap requestVaultPermission in a
// busy-operation guard before the prompt fires.
export async function requestVaultPermission(handle) {
  if (!handle) return false;
  const current = await queryVaultPermission(handle);
  if (current === "granted") return true;
  if (typeof handle.requestPermission !== "function") return false;
  try {
    return await handle.requestPermission({ mode: "readwrite" }) === "granted";
  } catch {
    return false;
  }
}

export async function reconnectRememberedVault() {
  const handle = state.rememberedVaultHandle;
  if (!handle) return false;
  const granted = await requestVaultPermission(handle);
  if (!granted) {
    updateVaultStatus("Reconnect was not granted. Open a vault folder to continue.");
    return false;
  }
  await callbacks.runVaultOperation("vault reconnect", async () => {
    await scaffoldVault(handle);
    setActiveVault(handle, handle.name);
    await loadExistingVault(handle);
  });
  return true;
}

export async function restoreRememberedVault() {
  if (!hasFileSystemAccess()) {
    updateVaultStatus("Local vault persistence needs Chrome or Edge on localhost.");
    return;
  }

  try {
    const handle = await loadVaultHandle();
    if (!handle) {
      updateVaultStatus("No local vault connected.");
      return;
    }

    state.rememberedVaultHandle = handle;
    updateVaultStatus(`Last vault: ${handle.name}. Click Reconnect to open it.`);
    const permission = await queryVaultPermission(handle);
    if (permission === "granted") {
      setActiveVault(handle, handle.name);
      await scaffoldVault(handle);
      await loadExistingVault(handle);
    } else {
      callbacks.updateWorkflowState?.();
    }
  } catch (error) {
    // Log the full stack so the dev console shows where the throw came
    // from; the user-facing status only carries the message.
    console.error("restoreRememberedVault threw:", error);
    updateVaultStatus(`Could not restore last vault: ${error.message || "unknown error"}`);
  }
}

// FS-Access directory picker — must run synchronously inside the click
// handler. Do NOT wrap callers in withBusyOperation before this fires.
async function pickVaultDirectory(actionLabel) {
  if (!("showDirectoryPicker" in window)) {
    if (els?.stats) els.stats.textContent = "Local vaults need Chrome or Edge on localhost. Use Download vault JSON for now.";
    updateVaultStatus("Local vault persistence needs Chrome or Edge on localhost.");
    return null;
  }

  if (els?.stats) els.stats.textContent = "Select a vault folder in the system picker.";
  updateVaultStatus("Waiting for folder selection...");
  try {
    return await window.showDirectoryPicker({ mode: "readwrite" });
  } catch (error) {
    if (error.name === "AbortError") {
      if (els?.stats) els.stats.textContent = "Folder selection canceled.";
      restoreVaultStatusAfterPickerCancel();
      callbacks.updateWorkflowState?.();
      return null;
    }
    if (els?.stats) els.stats.textContent = `${actionLabel} failed: ${error.message || "unknown error"}`;
    updateVaultStatus("No local vault connected.");
    callbacks.updateWorkflowState?.();
    return null;
  }
}

function restoreVaultStatusAfterPickerCancel() {
  if (state.vaultHandle) {
    updateVaultStatus(state.vaultName || "Vault connected.");
  } else if (state.rememberedVaultHandle) {
    updateVaultStatus(`Last vault: ${state.rememberedVaultHandle.name}. Click Reconnect to open it.`);
  } else {
    updateVaultStatus("No local vault connected.");
  }
}

export async function createVault() {
  const handle = await pickVaultDirectory("Vault creation");
  if (!handle) return null;
  return callbacks.runVaultOperation("vault creation", async () => {
    await scaffoldVault(handle);
    setActiveVault(handle, handle.name);
    state.loadedFileMap = await readVaultFileMap(handle);
    callbacks.renderChangePreview?.();
    callbacks.renderVaultTree?.();
    if (els?.stats) els.stats.textContent = `Created vault structure in: ${handle.name}`;
    return handle;
  });
}

export async function openVault() {
  if (!("showDirectoryPicker" in window)) {
    if (els?.stats) els.stats.textContent = "Local vaults need Chrome or Edge on localhost. Use Download vault JSON for now.";
    return null;
  }

  const handle = await pickVaultDirectory("Vault open");
  if (!handle) return null;
  return callbacks.runVaultOperation("vault open", async () => {
    await scaffoldVault(handle);
    setActiveVault(handle, handle.name);
    await loadExistingVault(handle);
    return handle;
  });
}

export async function loadExistingVault(handle) {
  // Single batch render at the end; suppress every staged render in
  // between via state.vaultLoading + body.is-vault-loading class.
  // CRITICAL: also defer setting state.loadedFileMap until the very
  // end. activeActivityFileMap() falls back to loadedFileMap, so any
  // incidental render call mid-load would surface the wiki portion
  // first — exactly the flicker we're trying to avoid.
  state.vaultLoading = true;
  document.body.classList.add("is-vault-loading");
  const loadingEl = document.getElementById("vault-loading");
  const loadingStatusEl = document.getElementById("vault-loading-status");
  if (loadingEl) loadingEl.hidden = false;
  if (loadingStatusEl) loadingStatusEl.textContent = "Reading wiki files";

  const fileMap = await readVaultFileMap(handle);

  state.vaultFiles = [];
  state.editedRawFiles = new Map();
  state.files = [];
  if (loadingStatusEl) {
    loadingStatusEl.textContent = fileMap.size
      ? `Scanning ${fileMap.size} wiki file${fileMap.size === 1 ? "" : "s"} for sources`
      : "Scanning vault for sources";
  }
  if (els?.stats) {
    els.stats.textContent = fileMap.size
      ? `Opened ${state.vaultName}: ${fileMap.size} vault file${fileMap.size === 1 ? "" : "s"} loaded. Scanning raw/ sources...`
      : `Opened ${state.vaultName}. No wiki files found yet. Scanning raw/ sources...`;
  }

  let rawFiles = [];
  try {
    rawFiles = await readRawSourcesFromVault(handle);
  } catch (error) {
    state.vaultLoading = false;
    document.body.classList.remove("is-vault-loading");
    if (loadingEl) loadingEl.hidden = true;
    state.loadedFileMap = new Map(fileMap);
    applyLoadedVaultFileMap(fileMap);
    if (els?.stats) {
      els.stats.textContent = fileMap.size
        ? `Opened ${state.vaultName}: ${fileMap.size} vault file${fileMap.size === 1 ? "" : "s"} loaded. Raw scan failed: ${error.message || "unknown error"}`
        : `Opened ${state.vaultName}, but raw scan failed: ${error.message || "unknown error"}`;
    }
    callbacks.updateWorkflowState?.();
    return;
  }

  if (loadingStatusEl) loadingStatusEl.textContent = "Finishing up";
  state.vaultFiles = rawFiles;
  state.files = pendingRawSourcesFromVault(fileMap, rawFiles);
  state.hasSavedCurrent = fileMap.size > 0 || rawFiles.length > 0;
  state.loadedFileMap = new Map(fileMap);
  // Single batch render — applies the file map + raw files together.
  state.vaultLoading = false;
  document.body.classList.remove("is-vault-loading");
  if (loadingEl) loadingEl.hidden = true;
  applyLoadedVaultFileMap(fileMap);
  callbacks.renderSources?.();
  callbacks.renderVaultTree?.(fileMap);
  callbacks.updateSaveButtonState?.();
  callbacks.updateActionState?.();
  if (els?.stats) {
    els.stats.textContent = rawFiles.length
      ? `Opened ${state.vaultName}: ${rawFiles.length} source file${rawFiles.length === 1 ? "" : "s"} loaded from raw/ and ${fileMap.size} vault file${fileMap.size === 1 ? "" : "s"} loaded`
      : `Opened ${state.vaultName}: ${fileMap.size} vault file${fileMap.size === 1 ? "" : "s"} loaded`;
  }
}

function applyLoadedVaultFileMap(fileMap) {
  state.vault = null;
  state.currentFileMap = fileMap;
  state.selectedPath = null;
  state.selectedKind = "";
  state.llmFiles = new Map();
  state.llmSelectedPath = null;
  state.currentMaterialQuestions = [];
  state.llmPromptCopied = false;
  state.hasSavedCurrent = fileMap.size > 0;
  state.hasUnsavedEdits = false;
  state.pendingSave = false;
  // Per-renderer try/catch so a single throwing callback can't blow up
  // the whole load sequence — and the failing one identifies itself in
  // the console with a precise stack.
  const safeCall = (label, fn) => {
    if (typeof fn !== "function") return;
    try { fn(); } catch (error) {
      console.error(`applyLoadedVaultFileMap: ${label} threw`, error);
    }
  };
  safeCall("renderSources", () => callbacks.renderSources?.());
  safeCall("renderVaultTree", () => callbacks.renderVaultTree?.(fileMap));
  safeCall("renderWikiFiles", () => callbacks.renderWikiFiles?.(fileMap));
  safeCall("renderOperatingLayer", () => callbacks.renderOperatingLayer?.(fileMap));
  safeCall("renderAcceptedLlmEditState", () => callbacks.renderAcceptedLlmEditState?.());
  if (callbacks.drawGraph && callbacks.graphFromFileMap) {
    safeCall("drawGraph", () => callbacks.drawGraph(callbacks.graphFromFileMap(fileMap)));
  }
  safeCall("renderChangePreview", () => callbacks.renderChangePreview?.());
  if (els?.exportBtn) els.exportBtn.disabled = fileMap.size === 0;
  safeCall("updateSaveButtonState", () => callbacks.updateSaveButtonState?.());
  if (els?.copyBtn) els.copyBtn.disabled = true;
  safeCall("updateWorkflowState", () => callbacks.updateWorkflowState?.());
}

// ---------------------------------------------------------------------
// Save flows
// ---------------------------------------------------------------------

export async function savePendingRawSourcesImmediately(files = state.files) {
  if (!state.vaultHandle || files.length === 0) return 0;
  const rawSourceAlreadySaved = helpers.rawSourceAlreadySaved || (() => false);
  const mergeSourceFiles = helpers.mergeSourceFiles || ((existing) => existing);
  const toWrite = files
    .filter((file) => !rawSourceAlreadySaved(file))
    .map((file) => ({ ...file, sourceScope: "vault" }));
  const written = toWrite.length ? await writeRawSources(state.vaultHandle, toWrite) : 0;
  for (const file of files) {
    file.sourceScope = "vault";
    await refreshRawSourceBlobFromVault(file);
  }
  state.vaultFiles = mergeSourceFiles(state.vaultFiles, files.map((file) => ({ ...file, sourceScope: "vault", dirtyRaw: false })));
  callbacks.renderVaultTree?.(state.currentFileMap);
  return written;
}

export async function prepareSourcesForProcessing(files) {
  const extractPdfTextForSource = helpers.extractPdfTextForSource;
  const extractDocxTextForSource = helpers.extractDocxTextForSource;
  for (const file of files) {
    if (file.text) continue;

    if (file.type === "pdf" && extractPdfTextForSource) {
      await extractPdfTextForSource(file);
    } else if (file.type === "docx" && extractDocxTextForSource) {
      await extractDocxTextForSource(file);
    }
  }
}

export async function saveCurrentVault(options = {}) {
  if (!state.currentFileMap) return;
  const vault = state.vaultHandle || await createVault();
  if (!vault) return;

  const mergeSourceFiles = helpers.mergeSourceFiles || ((existing) => existing);
  const allSourceFiles = helpers.allSourceFiles || (() => []);
  const rawSourcesNeedingWrite = helpers.rawSourcesNeedingWrite || ((files) => files);
  const buildReviewDecisionLog = helpers.buildReviewDecisionLog || ((notes) => String(notes || ""));

  const saveBtn = els?.saveVaultBtn;
  const docSaveBtn = els?.docSaveBtn;
  if (saveBtn) saveBtn.disabled = true;
  if (docSaveBtn) docSaveBtn.disabled = true;
  const originalText = saveBtn ? saveBtn.textContent : "Save";
  if (saveBtn) saveBtn.textContent = "Saving...";
  if (docSaveBtn) docSaveBtn.textContent = "Saving...";

  try {
    const pendingRaw = mergeSourceFiles(state.files, [...state.editedRawFiles.values()]);
    const sourceCount = allSourceFiles().length;
    const rawToWrite = rawSourcesNeedingWrite(pendingRaw);
    const writtenRaw = rawToWrite.length ? await writeRawSources(vault, rawToWrite) : 0;
    const reviewNotes = els?.reviewReply ? els.reviewReply.value.trim() : "";
    if (reviewNotes) {
      state.currentFileMap.set("wiki/.margins/review-decisions.md", buildReviewDecisionLog(reviewNotes));
    }
    const writtenFiles = await writeFileMap(vault, state.currentFileMap, state.loadedFileMap || new Map());
    await writeTextFile(vault, "wiki/.margins/export-summary.json", JSON.stringify({
      saved_at: new Date().toISOString(),
      vault: state.vaultName,
      raw_sources: writtenRaw,
      generated_files: writtenFiles,
      new_source_count: pendingRaw.length,
      source_count: sourceCount,
      file_count: state.currentFileMap.size,
      write_mode: "direct-vault-save",
      warning: sourceCount === 0
        ? "No original source files were loaded in the browser when this folder was written."
        : ""
    }, null, 2));
    state.vaultFiles = mergeSourceFiles(state.vaultFiles, pendingRaw.map((file) => ({ ...file, sourceScope: "vault", dirtyRaw: false })));
    state.files = pendingRawSourcesFromVault(state.currentFileMap, state.vaultFiles);
    state.editedRawFiles = new Map();
    state.ingestReviews = new Map();
    state.ingestAnswers = new Map();
    state.ingestErrors = new Map();
    state.expandedSummaries = new Set();
    state.expandedReceiptLinks = new Set();
    state.revealedReceipts = new Set();
    state.loadedFileMap = new Map(state.currentFileMap);
    callbacks.renderSources?.();
    callbacks.renderVaultTree?.(state.currentFileMap);
    state.hasSavedCurrent = true;
    state.hasUnsavedEdits = false;
    state.pendingSave = false;
    state.llmPromptCopied = false;
    if (els?.reviewReply) els.reviewReply.value = "";
    if (els?.stats) {
      els.stats.textContent = pendingRaw.length === 0
        ? `Saved ${writtenFiles} wiki/operating files to ${state.vaultName}`
        : `Saved ${writtenFiles} wiki/operating file${writtenFiles === 1 ? "" : "s"} + ${writtenRaw} new source file${writtenRaw === 1 ? "" : "s"} to ${state.vaultName}`;
    }
    if (saveBtn) saveBtn.textContent = "Saved";
    if (docSaveBtn) docSaveBtn.textContent = "Saved";
    callbacks.renderWikiFiles?.(state.currentFileMap);
    callbacks.activateTab?.(options.afterSaveView || "wiki");
    callbacks.renderChangePreview?.();
    setTimeout(() => {
      if (saveBtn) saveBtn.textContent = originalText;
      if (docSaveBtn) docSaveBtn.textContent = "Save";
      callbacks.updateSaveButtonState?.();
    }, 1500);
  } catch (error) {
    if (error.name !== "AbortError" && els?.stats) {
      els.stats.textContent = `Vault save failed: ${error.message || "unknown error"}`;
    }
    if (saveBtn) saveBtn.textContent = originalText;
    if (docSaveBtn) docSaveBtn.textContent = "Save";
  } finally {
    callbacks.updateSaveButtonState?.();
    callbacks.updateWorkflowState?.();
  }
}
