import { compileVault, vaultToFiles } from "./compiler.js";
import { clearApiSettings, loadApiSettings, maskSecret, saveApiSettings } from "./apiSettingsStore.js";
import { hasFileSystemAccess, loadVaultHandle, saveVaultHandle } from "./vaultHandleStore.js";
import * as pdfjsLib from "../node_modules/pdfjs-dist/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "../node_modules/pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

const initialTheme = localStorage.getItem("margins-theme") || "dark";
document.documentElement.dataset.theme = initialTheme;
const API_SECRET_STORAGE_KEY = "margins.apiSecret.v1";

const state = {
  files: [],
  vaultFiles: [],
  vault: null,
  selectedPath: null,
  currentFileMap: null,
  loadedFileMap: new Map(),
  theme: initialTheme,
  reviewMode: localStorage.getItem("margins-review-mode") || "suggested",
  llmFiles: new Map(),
  llmSelectedPath: null,
  currentMaterialQuestions: [],
  llmPromptCopied: false,
  hasSavedCurrent: false,
  pendingSave: false,
  vaultHandle: null,
  rememberedVaultHandle: null,
  vaultName: "",
  apiSettings: loadApiSettings(),
  apiSecret: localStorage.getItem(API_SECRET_STORAGE_KEY) || "",
  apiQuestionSource: ""
};

const els = {
  themeToggle: document.getElementById("theme-toggle"),
  vaultStatus: document.getElementById("vault-status"),
  vaultTree: document.getElementById("vault-tree"),
  apiProvider: document.getElementById("api-provider"),
  apiModel: document.getElementById("api-model"),
  apiKey: document.getElementById("api-key"),
  saveApiKeyBtn: document.getElementById("save-api-key-btn"),
  clearApiKeyBtn: document.getElementById("clear-api-key-btn"),
  apiKeyStatus: document.getElementById("api-key-status"),
  workflowGuidance: document.getElementById("workflow-guidance"),
  workflowBtn: document.getElementById("workflow-btn"),
  sourceDropZone: document.getElementById("source-drop-zone"),
  folderInput: document.getElementById("folder-input"),
  fileInput: document.getElementById("file-input"),
  sourceList: document.getElementById("source-list"),
  extractBtn: document.getElementById("extract-btn"),
  compileBtn: document.getElementById("compile-btn"),
  llmBtn: document.getElementById("llm-btn"),
  createVaultBtn: document.getElementById("create-vault-btn"),
  openVaultBtn: document.getElementById("open-vault-btn"),
  saveVaultBtn: document.getElementById("save-vault-btn"),
  reviewMode: document.getElementById("review-mode"),
  reviewModeHelp: document.getElementById("review-mode-help"),
  exportBtn: document.getElementById("export-btn"),
  copyBtn: document.getElementById("copy-btn"),
  wikiTree: document.getElementById("wiki-tree"),
  docTitle: document.getElementById("doc-title"),
  docBody: document.getElementById("doc-body"),
  graphSvg: document.getElementById("graph-svg"),
  stats: document.getElementById("stats"),
  llmInput: document.getElementById("llm-input"),
  parseLlmBtn: document.getElementById("parse-llm-btn"),
  repairLlmBtn: document.getElementById("repair-llm-btn"),
  acceptLlmBtn: document.getElementById("accept-llm-btn"),
  llmStatus: document.getElementById("llm-status"),
  reviewQuestions: document.getElementById("review-questions"),
  reviewReply: document.getElementById("review-reply"),
  reviewResponseBtn: document.getElementById("review-response-btn"),
  llmFileList: document.getElementById("llm-file-list"),
  llmPreviewTitle: document.getElementById("llm-preview-title"),
  llmPreviewBody: document.getElementById("llm-preview-body"),
  operatorManual: document.getElementById("operator-manual"),
  queryCookbook: document.getElementById("query-cookbook"),
  commandsList: document.getElementById("commands-list"),
  agentsList: document.getElementById("agents-list"),
  editList: document.getElementById("edit-list")
};

els.workflowPanel = document.querySelector(".workflow-panel") || document.querySelector(".vault-card");
els.changeSummary = document.createElement("div");
els.changeSummary.id = "change-summary";
els.changeSummary.className = "mini-list";
if (els.workflowPanel) els.workflowPanel.appendChild(els.changeSummary);

els.changePreview = document.createElement("div");
els.changePreview.id = "change-preview";
els.changePreview.className = "mini-list";
els.llmStatus.after(els.changePreview);

els.themeToggle.checked = state.theme === "dark";
hydrateApiControls();
els.folderInput.addEventListener("change", handleSourceSelection);
els.fileInput.addEventListener("change", handleSourceSelection);
els.reviewMode.value = state.reviewMode;
updateReviewModeHelp();
updateWorkflowState();
renderVaultTree();
restoreRememberedVault();

els.themeToggle.addEventListener("change", () => {
  state.theme = els.themeToggle.checked ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
  localStorage.setItem("margins-theme", state.theme);
});

els.workflowBtn.addEventListener("click", runWorkflowStep);
els.saveApiKeyBtn.addEventListener("click", saveApiControls);
els.clearApiKeyBtn.addEventListener("click", clearApiControls);
els.apiProvider.addEventListener("change", () => {
  els.apiModel.value = defaultModelForProvider(els.apiProvider.value);
  renderApiStatus();
});

els.sourceDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  els.sourceDropZone.classList.add("dragging");
});

els.sourceDropZone.addEventListener("dragleave", () => {
  els.sourceDropZone.classList.remove("dragging");
});

els.sourceDropZone.addEventListener("drop", async (event) => {
  event.preventDefault();
  els.sourceDropZone.classList.remove("dragging");
  await setSourceFiles([...event.dataTransfer.files]);
});

async function handleSourceSelection(event) {
  await setSourceFiles([...event.target.files]);
}

async function restoreRememberedVault() {
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
      updateWorkflowState();
    }
  } catch (error) {
    updateVaultStatus(`Could not restore last vault: ${error.message || "unknown error"}`);
  }
}

function hydrateApiControls() {
  if (!els.apiProvider) return;
  const settings = state.apiSettings;
  els.apiProvider.value = providerValue(settings.providerLabel) || "openai";
  els.apiModel.value = settings.model || defaultModelForProvider(els.apiProvider.value);
  els.apiKey.value = "";
  renderApiStatus();
}

function saveApiControls() {
  const provider = els.apiProvider.value;
  const apiKey = els.apiKey.value.trim();
  const model = els.apiModel.value.trim() || defaultModelForProvider(provider);
  const settings = saveApiSettings({
    providerLabel: providerLabel(provider),
    endpointUrl: defaultEndpointForProvider(provider),
    model,
    apiKey: apiKey || state.apiSecret || ""
  });

  state.apiSettings = settings || loadApiSettings();
  if (apiKey) {
    state.apiSecret = apiKey;
    localStorage.setItem(API_SECRET_STORAGE_KEY, apiKey);
    els.apiKey.value = "";
  }
  renderApiStatus("API key saved locally for this browser.");
}

function clearApiControls() {
  clearApiSettings();
  localStorage.removeItem(API_SECRET_STORAGE_KEY);
  state.apiSettings = loadApiSettings();
  state.apiSecret = "";
  els.apiKey.value = "";
  els.apiModel.value = defaultModelForProvider(els.apiProvider.value);
  renderApiStatus("API key cleared.");
}

function renderApiStatus(message = "") {
  if (!els.apiKeyStatus) return;
  const secret = state.apiSecret;
  const settings = state.apiSettings;
  const provider = providerLabel(els.apiProvider?.value || providerValue(settings.providerLabel) || "openai");
  const model = els.apiModel?.value || settings.model || defaultModelForProvider(providerValue(settings.providerLabel));
  els.apiKeyStatus.textContent = message || (secret || settings.hasApiKey
    ? `${provider} · ${model} · ${maskSecret(secret) || settings.maskedApiKey}`
    : "Optional. Stored only in this browser for model-generated filing questions.");
}

function providerValue(label) {
  const value = String(label || "").toLowerCase();
  if (value.includes("anthropic")) return "anthropic";
  if (value.includes("local")) return "local";
  if (value.includes("openai")) return "openai";
  return value;
}

function providerLabel(value) {
  return {
    openai: "OpenAI",
    anthropic: "Anthropic",
    local: "Local model"
  }[value] || "OpenAI";
}

function defaultModelForProvider(provider) {
  return {
    openai: "gpt-5-mini",
    anthropic: "claude-3-5-haiku-latest",
    local: "local-filing-helper"
  }[provider] || "gpt-5-mini";
}

function defaultEndpointForProvider(provider) {
  return {
    openai: "https://api.openai.com/v1/chat/completions",
    anthropic: "https://api.anthropic.com/v1/messages",
    local: "http://localhost:11434/v1/chat/completions"
  }[provider] || "https://api.openai.com/v1/chat/completions";
}

async function setSourceFiles(files) {
  const normalized = normalizeSelectedFiles(files);
  state.files = await Promise.all(normalized.map(async (file) => ({
    ...await readBrowserFile(file),
    sourceScope: "pending"
  })));
  state.vault = null;
  if (!state.currentFileMap) {
    state.selectedPath = null;
  }
  state.llmFiles = new Map();
  state.llmSelectedPath = null;
  state.currentMaterialQuestions = [];
  els.llmInput.value = "";
  state.llmPromptCopied = false;
  state.hasSavedCurrent = false;
  state.pendingSave = false;
  renderLlmReview();
  renderChangePreview();
  renderSources();
  renderVaultTree();
  updateActionState();
  els.exportBtn.disabled = !state.currentFileMap;
  updateSaveButtonState();
  els.copyBtn.disabled = true;
  els.stats.textContent = state.currentFileMap
    ? `${state.files.length} new source${state.files.length === 1 ? "" : "s"} loaded · existing wiki retained`
    : `${state.files.length} source${state.files.length === 1 ? "" : "s"} loaded · 0 nodes · 0 edges`;
  updateWorkflowState();
  if (state.files.some((file) => file.type === "pdf" && file.extractionStatus !== "extracted")) {
    await extractPdfSources();
  }
}

els.extractBtn.addEventListener("click", extractPdfSources);

els.compileBtn.addEventListener("click", async () => {
  state.vault = compileVault(state.files, { name: "Karpathy Original" });
  state.selectedPath = null;
  state.currentFileMap = null;
  state.hasSavedCurrent = false;
  state.pendingSave = true;
  renderVault();
  await prepareReviewForCurrentFileMap("Local compile ready. Review the filing questions, then save to your vault.");
  updateWorkflowState();
});

els.llmBtn.addEventListener("click", async () => {
  await copyLlmIngestPrompt();
});

els.exportBtn.addEventListener("click", () => {
  if (state.vault) {
    const files = Object.fromEntries(vaultToFiles(state.vault));
    download("margins-vault.json", JSON.stringify({
      raw_sources: state.vault.rawSources.map(({ name, text }) => ({ name, text })),
      files
    }, null, 2));
    return;
  }
  if (state.currentFileMap) {
    download("margins-llm-wiki.json", JSON.stringify({
      raw_sources: allSourceFiles().map(({ name, text }) => ({ name, text })),
      files: Object.fromEntries(state.currentFileMap)
    }, null, 2));
    return;
  }
});

els.createVaultBtn.addEventListener("click", createVault);
els.openVaultBtn.addEventListener("click", openVault);
els.saveVaultBtn.addEventListener("click", handleSaveAndOrganize);

els.copyBtn.addEventListener("click", async () => {
  if (!state.vault) return;
  await navigator.clipboard.writeText(state.vault.operatingLayer.operatorManual);
  els.copyBtn.textContent = "Copied";
  setTimeout(() => { els.copyBtn.textContent = "Copy operator manual"; }, 1100);
});

async function createVault() {
  if (!("showDirectoryPicker" in window)) {
    els.stats.textContent = "Local vaults need Chrome or Edge on localhost. Use Download vault JSON for now.";
    return null;
  }

  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await scaffoldVault(handle);
    setActiveVault(handle, handle.name);
    state.loadedFileMap = await readVaultFileMap(handle);
    renderChangePreview();
    renderVaultTree();
    els.stats.textContent = `Created vault structure in: ${handle.name}`;
    return handle;
  } catch (error) {
    if (error.name !== "AbortError") {
      els.stats.textContent = `Vault creation failed: ${error.message || "unknown error"}`;
    }
    return null;
  }
}

async function openVault() {
  if (!("showDirectoryPicker" in window)) {
    els.stats.textContent = "Local vaults need Chrome or Edge on localhost. Use Download vault JSON for now.";
    return null;
  }

  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await scaffoldVault(handle);
    setActiveVault(handle, handle.name);
    await loadExistingVault(handle);
    return handle;
  } catch (error) {
    if (error.name !== "AbortError") {
      els.stats.textContent = `Vault open failed: ${error.message || "unknown error"}`;
    }
    return null;
  }
}

function setActiveVault(handle, name) {
  state.vaultHandle = handle;
  state.rememberedVaultHandle = handle;
  state.vaultName = name;
  els.createVaultBtn.textContent = `Vault: ${shortLabel(name)}`;
  els.openVaultBtn.textContent = "Open another vault";
  updateSaveButtonState();
  updateVaultStatus(`Connected: ${name}`);
  saveVaultHandle(handle).catch(() => {});
  updateWorkflowState();
}

function updateVaultStatus(message) {
  if (els.vaultStatus) els.vaultStatus.textContent = message;
}

async function queryVaultPermission(handle) {
  if (!handle || typeof handle.queryPermission !== "function") return "prompt";
  try {
    return await handle.queryPermission({ mode: "readwrite" });
  } catch {
    return "prompt";
  }
}

async function requestVaultPermission(handle) {
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

async function reconnectRememberedVault() {
  const handle = state.rememberedVaultHandle;
  if (!handle) return false;
  const granted = await requestVaultPermission(handle);
  if (!granted) {
    updateVaultStatus("Reconnect was not granted. Open a vault folder to continue.");
    return false;
  }
  await scaffoldVault(handle);
  setActiveVault(handle, handle.name);
  await loadExistingVault(handle);
  return true;
}

async function loadExistingVault(handle) {
  const [fileMap, rawFiles] = await Promise.all([
    readVaultFileMap(handle),
    readRawSourcesFromVault(handle)
  ]);

  state.vaultFiles = rawFiles;
  state.loadedFileMap = new Map(fileMap);
  state.files = [];
  renderSources();
  renderVaultTree(fileMap);
  updateActionState();

  if (hasVaultWikiContent(fileMap)) {
    state.vault = null;
    state.currentFileMap = fileMap;
    state.selectedPath = null;
    state.llmFiles = new Map();
    state.llmSelectedPath = null;
    state.currentMaterialQuestions = [];
    state.llmPromptCopied = false;
    state.hasSavedCurrent = true;
    state.pendingSave = false;
    renderWikiFiles(fileMap);
    renderOperatingLayer(fileMap);
    renderAcceptedLlmEditState();
    drawGraph(graphFromFileMap(fileMap));
    renderChangePreview();
    els.exportBtn.disabled = false;
    updateSaveButtonState();
    els.copyBtn.disabled = true;
    els.stats.textContent = `Opened ${state.vaultName}: ${fileMap.size} wiki/operating file${fileMap.size === 1 ? "" : "s"} loaded`;
    updateWorkflowState();
    return;
  }

  clearLoadedWiki();
  renderChangePreview();
  renderVaultTree(fileMap);
  els.stats.textContent = rawFiles.length
    ? `Opened ${state.vaultName}: ${rawFiles.length} raw source${rawFiles.length === 1 ? "" : "s"} loaded`
    : `Opened vault: ${state.vaultName}`;
}

function clearLoadedWiki() {
  state.vault = null;
  state.currentFileMap = null;
  state.selectedPath = null;
  state.llmFiles = new Map();
  state.llmSelectedPath = null;
  state.currentMaterialQuestions = [];
  state.hasSavedCurrent = false;
  state.pendingSave = false;
  renderWikiFiles(new Map());
  renderOperatingLayer(new Map());
  renderVaultTree(new Map());
  els.editList.className = "edit-list empty";
  els.editList.textContent = "Open or accept wiki files to see edit proposals.";
  drawGraph({ nodes: [], edges: [] });
  els.exportBtn.disabled = true;
  updateSaveButtonState();
  els.copyBtn.disabled = true;
  renderChangePreview();
  updateWorkflowState();
}

function hasVaultWikiContent(fileMap) {
  return [...fileMap.keys()].some((path) => /^wiki\/(sources|concepts|entities|synthesis)\/[^/]+\.md$/.test(path));
}

async function handleSaveAndOrganize() {
  if (state.pendingSave && state.currentFileMap) {
    await saveCurrentVault();
    return;
  }

  if (state.files.length > 0) {
    await prepareInboxSave();
    return;
  }

  if (state.currentFileMap) {
    await saveCurrentVault();
  }
}

async function prepareInboxSave() {
  if (!state.vaultHandle) {
    const reconnected = await reconnectRememberedVault();
    if (!reconnected && !await openVault()) return;
  }

  if (state.files.some((file) => file.type === "pdf" && file.extractionStatus === "needed")) {
    await extractPdfSources();
  }

  state.vault = compileVault(state.files, { name: state.vaultName || "Karpathy Original" });
  state.selectedPath = null;
  state.currentFileMap = mergeFileMaps(state.currentFileMap, vaultToFiles(state.vault));
  state.hasSavedCurrent = false;
  state.pendingSave = true;
  renderWikiFiles(state.currentFileMap);
  renderOperatingLayer(state.currentFileMap);
  renderAcceptedLlmEditState();
  drawGraph(graphFromFileMap(state.currentFileMap));
  renderSources();
  renderVaultTree(state.currentFileMap);
  renderChangePreview();
  els.exportBtn.disabled = false;
  updateSaveButtonState();
  els.copyBtn.disabled = false;
  await prepareReviewForCurrentFileMap("Margins organized the queue. Answer the quick checks, then click Save and organize again to write the vault.");
}

async function saveCurrentVault() {
  if (!state.currentFileMap) return;
  const vault = state.vaultHandle || await createVault();
  if (!vault) return;

  els.saveVaultBtn.disabled = true;
  const originalText = els.saveVaultBtn.textContent;
  els.saveVaultBtn.textContent = "Saving...";

  try {
    const pendingRaw = state.files;
    const sourceCount = allSourceFiles().length;
    const writtenRaw = pendingRaw.length ? await writeRawSources(vault, pendingRaw) : 0;
    const reviewNotes = els.reviewReply.value.trim();
    if (reviewNotes) {
      state.currentFileMap.set("wiki/.margins/review-decisions.md", buildReviewDecisionLog(reviewNotes));
    }
    const writtenFiles = await writeFileMap(vault, state.currentFileMap);
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
        ? "No raw source files were loaded in the browser when this folder was written."
        : ""
    }, null, 2));
    state.vaultFiles = mergeSourceFiles(state.vaultFiles, pendingRaw.map((file) => ({ ...file, sourceScope: "vault" })));
    state.files = [];
    state.loadedFileMap = new Map(state.currentFileMap);
    renderSources();
    renderVaultTree(state.currentFileMap);
    state.hasSavedCurrent = true;
    state.pendingSave = false;
    state.llmPromptCopied = false;
    els.reviewReply.value = "";
    els.stats.textContent = pendingRaw.length === 0
      ? `Saved ${writtenFiles} wiki/operating files to ${state.vaultName}`
      : `Saved ${writtenFiles} wiki/operating file${writtenFiles === 1 ? "" : "s"} + ${writtenRaw} new raw source${writtenRaw === 1 ? "" : "s"} to ${state.vaultName}`;
    els.saveVaultBtn.textContent = "Saved";
    renderChangePreview();
    setTimeout(updateSaveButtonState, 1500);
  } catch (error) {
    if (error.name !== "AbortError") {
      els.stats.textContent = `Vault save failed: ${error.message || "unknown error"}`;
    }
    els.saveVaultBtn.textContent = originalText;
  } finally {
    updateSaveButtonState();
    updateWorkflowState();
  }
}

function buildReviewDecisionLog(notes) {
  return `# Review Decisions

Updated: ${new Date().toISOString()}

These are the user-facing filing decisions captured before the latest local save.

${notes}
`;
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    activateTab(tab.dataset.view);
  });
});

els.reviewMode.addEventListener("change", () => {
  state.reviewMode = els.reviewMode.value;
  localStorage.setItem("margins-review-mode", state.reviewMode);
  updateReviewModeHelp();
  if (state.llmFiles.size > 0) renderLlmReview();
  else if (state.pendingSave && state.currentFileMap) {
    prepareReviewForCurrentFileMap("Review mode changed.");
  }
  updateWorkflowState();
});

els.llmInput.addEventListener("input", () => {
  const parsed = parseLlmFiles(els.llmInput.value);
  if (parsed.size === 0 && state.llmFiles.size === 0) {
    updateWorkflowState();
    return;
  }
  if (parsed.size > 0 && serializeLlmFiles(parsed) !== serializeLlmFiles(state.llmFiles)) {
    els.reviewReply.value = "";
  }
  state.llmFiles = parsed;
  state.hasSavedCurrent = false;
  state.pendingSave = false;
  updateSaveButtonState();
  els.exportBtn.disabled = true;
  renderLlmReview();
  renderChangePreview();
});

els.parseLlmBtn.addEventListener("click", () => {
  state.llmFiles = parseLlmFiles(els.llmInput.value);
  els.reviewReply.value = "";
  state.hasSavedCurrent = false;
  state.pendingSave = false;
  updateSaveButtonState();
  els.exportBtn.disabled = true;
  renderLlmReview();
  renderChangePreview();
});

els.repairLlmBtn.addEventListener("click", async () => {
  await copyLlmRepairPrompt();
});

els.reviewReply.addEventListener("input", () => {
  updateReviewResponseState();
  updateWorkflowState();
});

els.reviewResponseBtn.addEventListener("click", async () => {
  await copyReviewResponsePrompt();
});

els.acceptLlmBtn.addEventListener("click", () => {
  acceptLlmFiles();
});

async function copyLlmIngestPrompt() {
  if (state.files.length === 0) return;
  await navigator.clipboard.writeText(buildLlmIngestPrompt(state.files, state.currentFileMap));
  state.llmPromptCopied = true;
  els.llmBtn.textContent = "Copied";
  setTimeout(() => { els.llmBtn.textContent = "Copy LLM ingest prompt"; }, 1100);
  activateTab("llm");
  els.llmInput.focus();
  updateWorkflowState();
}

async function copyLlmRepairPrompt() {
  if (state.llmFiles.size === 0) return;
  await navigator.clipboard.writeText(buildLlmRepairPrompt(state.llmFiles));
  els.repairLlmBtn.textContent = "Copied";
  setTimeout(() => { els.repairLlmBtn.textContent = "Copy repair prompt"; }, 1100);
  activateTab("llm");
  updateWorkflowState();
}

async function copyReviewResponsePrompt() {
  const reply = els.reviewReply.value.trim();
  if (state.llmFiles.size === 0 || !reply) return;
  await navigator.clipboard.writeText(buildReviewResponsePrompt(
    state.llmFiles,
    state.currentMaterialQuestions,
    reply,
    state.reviewMode
  ));
  els.reviewResponseBtn.textContent = "Copied";
  setTimeout(() => { els.reviewResponseBtn.textContent = "Copy review response prompt"; }, 1100);
  activateTab("llm");
  updateWorkflowState();
}

function acceptLlmFiles() {
  if (state.llmFiles.size === 0) return false;
  const acceptedCount = state.llmFiles.size;
  state.vault = null;
  state.currentFileMap = mergeFileMaps(state.currentFileMap, state.llmFiles);
  state.selectedPath = null;
  state.hasSavedCurrent = false;
  state.pendingSave = true;
  state.llmFiles = new Map();
  state.currentMaterialQuestions = [];
  renderWikiFiles(state.currentFileMap);
  renderOperatingLayer(state.currentFileMap);
  renderAcceptedLlmEditState();
  drawGraph(graphFromFileMap(state.currentFileMap));
  renderChangePreview();
  els.exportBtn.disabled = false;
  updateSaveButtonState();
  els.acceptLlmBtn.disabled = true;
  els.repairLlmBtn.disabled = true;
  els.copyBtn.disabled = true;
  els.llmStatus.textContent = `Accepted ${acceptedCount} returned file${acceptedCount === 1 ? "" : "s"} into the current wiki. Save to write the vault.`;
  activateTab("wiki");
  updateWorkflowState();
  return true;
}

async function prepareReviewForCurrentFileMap(statusText) {
  if (!state.currentFileMap) return;
  const warningsByPath = validateLlmFiles(state.currentFileMap);
  let questions = buildMaterialQuestions(state.currentFileMap, warningsByPath, state.reviewMode);
  state.apiQuestionSource = "heuristic";

  if (state.apiSecret) {
    els.llmStatus.textContent = "Asking the configured model for filing questions...";
    try {
      const apiQuestions = await generateApiReviewQuestions(state.currentFileMap, state.files);
      if (apiQuestions.length > 0) {
        questions = apiQuestions;
        state.apiQuestionSource = "api";
      }
    } catch (error) {
      els.llmStatus.textContent = `API question generation failed, using local questions: ${error.message || "unknown error"}`;
    }
  }

  state.currentMaterialQuestions = dedupeQuestions(questions).slice(0, state.reviewMode === "strict" ? 12 : 6);
  renderMaterialQuestions(state.currentMaterialQuestions);
  els.llmStatus.textContent = `${statusText} ${state.currentMaterialQuestions.length} quick check${state.currentMaterialQuestions.length === 1 ? "" : "s"} generated by ${state.apiQuestionSource === "api" ? "the configured model" : "local review rules"}.`;
  activateTab("llm");
  updateWorkflowState();
}

async function generateApiReviewQuestions(fileMap, files) {
  const provider = els.apiProvider?.value || providerValue(state.apiSettings.providerLabel) || "openai";
  if (provider !== "openai" && provider !== "local") {
    throw new Error("Direct browser calls are only wired for OpenAI-compatible endpoints right now.");
  }

  const endpoint = defaultEndpointForProvider(provider);
  const model = els.apiModel?.value.trim() || defaultModelForProvider(provider);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${state.apiSecret}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "You generate concise filing review questions for a local-first personal wiki. Return JSON only."
        },
        {
          role: "user",
          content: buildApiQuestionPrompt(fileMap, files)
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const json = await response.json();
  const content = json.choices?.[0]?.message?.content || "";
  return parseApiQuestions(content);
}

function buildApiQuestionPrompt(fileMap, files) {
  const sourceNames = files.map((file) => `- ${file.name}: ${excerptForQuestion(file.text || file.extractionError || "", 600)}`).join("\n") || "- No new source text available.";
  const changedPaths = [...fileMap.keys()]
    .filter((path) => isWikiPagePath(path) || path.startsWith("wiki/.margins/"))
    .slice(0, 28)
    .join("\n");
  return `Create 2-5 quick filing questions before Margins saves this local vault.

Rules:
- Ask only durable questions that affect where files/pages go or whether a node should exist.
- Prefer yes/no or short option buttons.
- Include a default recommendation.
- Do not ask generic approval questions.

Return JSON:
{"questions":[{"kind":"Quick check","path":"wiki/...","question":"...","reason":"...","recommendation":"My take: ...","options":["Yes","No","Use default"]}]}

New sources:
${sourceNames}

Changed paths:
${changedPaths}`;
}

function parseApiQuestions(content) {
  const parsed = parseJsonObject(content);
  const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
  return questions
    .map((question) => reviewQuestion(
      "suggest",
      question.kind || "Quick check",
      question.path || "vault",
      question.question || "",
      question.reason || "The model flagged this as a filing decision.",
      question.recommendation || "My take: use the default unless it looks wrong.",
      Array.isArray(question.options) && question.options.length ? question.options.slice(0, 4) : ["Yes", "No", "Use default"]
    ))
    .filter((question) => question.question);
}

function parseJsonObject(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = String(content || "").match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function excerptForQuestion(text, max) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max).trim()}...`;
}

function renderChangePreview() {
  const parsedMode = state.llmFiles.size > 0;
  const unsavedMode = !parsedMode && state.currentFileMap && state.pendingSave;
  const baseMap = parsedMode
    ? state.currentFileMap || new Map()
    : state.loadedFileMap || new Map();
  const targetMap = parsedMode ? state.llmFiles : state.currentFileMap;
  const fileChanges = targetMap
    ? (parsedMode ? patchChangePlan(baseMap, targetMap) : fullChangePlan(baseMap, targetMap))
    : [];
  const rawChanges = (parsedMode || unsavedMode) ? rawSourceChangePlan() : [];
  const visibleChanges = fileChanges.filter((change) => change.status !== "unchanged");
  const summaryChanges = parsedMode ? fileChanges : visibleChanges;

  if (!parsedMode && !unsavedMode) {
    els.changeSummary.innerHTML = "";
    els.changePreview.innerHTML = "";
    return;
  }

  const title = parsedMode ? "Returned files" : "Save preview";
  const createCount = summaryChanges.filter((change) => change.status === "create").length;
  const overwriteCount = summaryChanges.filter((change) => change.status === "overwrite").length;
  const unchangedCount = summaryChanges.filter((change) => change.status === "unchanged").length;
  const rawCreateCount = rawChanges.filter((change) => change.status === "create").length;
  const rawOverwriteCount = rawChanges.filter((change) => change.status === "overwrite").length;
  const summaryParts = [
    createCount ? `${createCount} new` : "",
    overwriteCount ? `${overwriteCount} overwrite` : "",
    rawCreateCount ? `${rawCreateCount} raw new` : "",
    rawOverwriteCount ? `${rawOverwriteCount} raw overwrite` : "",
    parsedMode && unchangedCount ? `${unchangedCount} unchanged` : ""
  ].filter(Boolean);
  const summaryText = summaryParts.join(" · ") || "No file changes detected";

  els.changeSummary.innerHTML = `
    <div class="mini-card">
      <strong>${escapeHtml(title)}</strong><br>
      <span>${escapeHtml(summaryText)}</span>
    </div>
  `;

  const detailChanges = [
    ...summaryChanges.map((change) => ({ ...change, kind: "wiki/ops" })),
    ...rawChanges.map((change) => ({ ...change, kind: "raw source" }))
  ];

  if (detailChanges.length === 0) {
    els.changePreview.innerHTML = `
      <div class="mini-card">
        <strong>${escapeHtml(title)}</strong><br>
        <span>No file changes detected before save.</span>
      </div>
    `;
    return;
  }

  els.changePreview.innerHTML = `
    <div class="mini-card">
      <strong>${escapeHtml(title)}</strong><br>
      <span>${escapeHtml(summaryText)}. Review these paths before accepting or saving.</span>
    </div>
    ${detailChanges.slice(0, 18).map((change) => `
      <div class="mini-card">
        <strong>${escapeHtml(changeStatusLabel(change.status))}: ${escapeHtml(change.path)}</strong><br>
        <span>${escapeHtml(change.kind)}${change.words ? ` · ${change.words} words` : ""}</span>
      </div>
    `).join("")}
    ${detailChanges.length > 18 ? `<div class="mini-card"><span>${detailChanges.length - 18} more file changes not shown here.</span></div>` : ""}
  `;
}

function patchChangePlan(baseMap, patchMap) {
  return [...patchMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, body]) => ({
      path,
      status: !baseMap.has(path) ? "create" : baseMap.get(path) === body ? "unchanged" : "overwrite",
      words: wordCount(body)
    }));
}

function fullChangePlan(baseMap, nextMap) {
  return [...nextMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, body]) => ({
      path,
      status: !baseMap.has(path) ? "create" : baseMap.get(path) === body ? "unchanged" : "overwrite",
      words: wordCount(body)
    }));
}

function rawSourceChangePlan() {
  const existing = new Set(state.vaultFiles.map((file) => file.name));
  return state.files
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((file) => ({
      path: rawSourceOutputPath(file.name),
      status: existing.has(file.name) ? "overwrite" : "create",
      words: wordCount(file.text || "")
    }));
}

function changeStatusLabel(status) {
  return {
    create: "Create",
    overwrite: "Overwrite",
    unchanged: "Unchanged"
  }[status] || status;
}

function mergeFileMaps(baseFileMap, changedFileMap) {
  const merged = new Map(baseFileMap || []);
  for (const [path, body] of changedFileMap.entries()) {
    merged.set(path, body);
  }
  return merged;
}

function renderSources() {
  const files = allSourceFiles();
  if (files.length === 0) {
    els.sourceList.className = "source-list empty";
    els.sourceList.textContent = "No sources loaded.";
    return;
  }
  els.sourceList.className = "source-list";
  els.sourceList.innerHTML = files.map((file) => `
    <div class="source-item ${sourceClass(file)}">
      <strong>${escapeHtml(file.name)}</strong>
      <span>${escapeHtml(sourceStatus(file))}</span>
    </div>
  `).join("");
}

function renderVaultTree(fileMap = state.currentFileMap) {
  if (!els.vaultTree) return;
  const rawFiles = allSourceFiles();
  const entries = fileMap ? [...fileMap.keys()].sort() : [];
  const groups = [
    ["raw_sources/", rawFiles.map((file) => rawSourceOutputPath(file.name))],
    ["wiki/sources/", entries.filter((path) => path.startsWith("wiki/sources/"))],
    ["wiki/concepts/", entries.filter((path) => path.startsWith("wiki/concepts/"))],
    ["wiki/entities/", entries.filter((path) => path.startsWith("wiki/entities/"))],
    ["wiki/synthesis/", entries.filter((path) => path.startsWith("wiki/synthesis/"))],
    ["commands/", entries.filter((path) => path.startsWith("commands/"))],
    ["agents/", entries.filter((path) => path.startsWith("agents/"))],
    ["wiki/.margins/", entries.filter((path) => path.startsWith("wiki/.margins/"))]
  ];
  const rootFiles = entries.filter((path) => path === "operator-manual.md" || path === "query-cookbook.md" || path === "wiki/index.md");

  els.vaultTree.innerHTML = [
    `<div class="vault-tree-root"><strong>${escapeHtml(state.vaultName || "local vault")}</strong></div>`,
    ...groups.map(([label, paths]) => `
      <div class="vault-tree-folder">
        <span>${escapeHtml(label)}</span>
        <em>${paths.length}</em>
      </div>
      ${paths.slice(0, 6).map((path) => `<button class="vault-tree-file" type="button" data-path="${escapeHtml(normalizeMarginsPath(path))}">${escapeHtml(basename(path))}</button>`).join("")}
      ${paths.length > 6 ? `<div class="vault-tree-more">${paths.length - 6} more</div>` : ""}
    `),
    ...rootFiles.map((path) => `<button class="vault-tree-file root-file" type="button" data-path="${escapeHtml(path)}">${escapeHtml(path)}</button>`)
  ].join("");

  els.vaultTree.querySelectorAll(".vault-tree-file").forEach((item) => {
    item.addEventListener("click", () => {
      const path = item.dataset.path;
      if (state.currentFileMap?.has(path) && isWikiPagePath(path)) {
        activateTab("wiki");
        state.selectedPath = path;
        els.docTitle.textContent = path;
        els.docBody.textContent = state.currentFileMap.get(path);
      } else if (state.currentFileMap?.has(path)) {
        activateTab("ops");
      }
    });
  });
}

function allSourceFiles() {
  const byName = new Map();
  for (const file of state.vaultFiles) byName.set(file.name, file);
  for (const file of state.files) byName.set(file.name, file);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function mergeSourceFiles(existing, incoming) {
  const byName = new Map();
  for (const file of existing) byName.set(file.name, file);
  for (const file of incoming) byName.set(file.name, file);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function updateReviewModeHelp() {
  els.reviewModeHelp.textContent = {
    auto: "File automatically unless serious warnings appear.",
    suggested: "Ask only about durable wiki decisions, with a recommended default.",
    strict: "Ask before promotions, synthesis, and sensitive-source saves."
  }[state.reviewMode] || "";
}

async function runWorkflowStep() {
  const step = workflowStep();
  if (step.disabled) return;

  if (step.action === "vault") {
    await openVault();
  } else if (step.action === "reconnectVault") {
    await reconnectRememberedVault();
  } else if (step.action === "sources") {
    els.fileInput.value = "";
    els.fileInput.click();
  } else if (step.action === "extract") {
    await extractPdfSources();
  } else if (step.action === "copyPrompt") {
    await copyLlmIngestPrompt();
  } else if (step.action === "paste") {
    activateTab("llm");
    els.llmInput.focus();
  } else if (step.action === "repair") {
    await copyLlmRepairPrompt();
  } else if (step.action === "reviewReply") {
    await copyReviewResponsePrompt();
  } else if (step.action === "acceptSave") {
    if (acceptLlmFiles()) await saveCurrentVault();
  } else if (step.action === "prepareInboxSave") {
    await prepareInboxSave();
  } else if (step.action === "save") {
    await saveCurrentVault();
  }

  updateWorkflowState();
}

function updateWorkflowState() {
  const step = workflowStep();
  els.workflowGuidance.textContent = step.guidance;
  els.workflowBtn.textContent = step.label;
  els.workflowBtn.disabled = !!step.disabled;
}

function workflowStep() {
  if (!state.vaultHandle) {
    if (state.rememberedVaultHandle) {
      return {
        action: "reconnectVault",
        label: "Reconnect vault",
        guidance: `Reconnect ${state.rememberedVaultHandle.name} to keep using your local vault.`
      };
    }
    return {
      action: "vault",
      label: "Choose vault folder",
      guidance: "Pick or create the local folder Margins will keep updating."
    };
  }

  if (state.pendingSave) {
    return {
      action: "save",
      label: "Write local vault",
      guidance: `Review is ready. Write these files into ${state.vaultName}.`
    };
  }

  if (state.files.length === 0) {
    return {
      action: "sources",
      label: "Add documents",
      guidance: state.currentFileMap
        ? `Loaded ${state.vaultName}. Add another document to grow this vault.`
        : `Vault selected: ${state.vaultName}. Now drop documents onto Sources or add files.`
    };
  }

  if (state.files.some((file) => file.extractionStatus === "extracting")) {
    return {
      action: "extracting",
      label: "Extracting PDFs...",
      guidance: "Margins is reading PDF text locally before it builds the LLM prompt.",
      disabled: true
    };
  }

  if (state.files.some((file) => file.type === "pdf" && file.extractionStatus === "needed")) {
    return {
      action: "extract",
      label: "Extract PDF text",
      guidance: "Some PDFs still need readable text before the language model can organize them."
    };
  }

  if (state.llmFiles.size > 0) {
    if (els.reviewReply.value.trim()) {
      return {
        action: "reviewReply",
        label: "Copy reply for LLM",
        guidance: "You wrote guidance for the model. Send it back once, then paste the revised output here."
      };
    }

    const warningCount = llmBlockingWarningCount();
    if (warningCount > 0) {
      return {
        action: "repair",
        label: "Copy cleanup prompt",
        guidance: `${warningCount} blocking formatting issue${warningCount === 1 ? "" : "s"} found. One cleanup pass should fix the output before saving.`
      };
    }

    const questionCount = state.currentMaterialQuestions.length;
    return {
      action: "acceptSave",
      label: "Accept and save",
      guidance: questionCount
        ? `${questionCount} optional review question${questionCount === 1 ? "" : "s"} found. Answer only if something looks wrong; otherwise save.`
        : state.currentFileMap
          ? "Clean incremental update is ready. Merge it into the vault and save."
          : "Clean LLM output is ready. Accept it and write the vault."
    };
  }

  if (els.llmInput.value.trim()) {
    return {
      action: "paste",
      label: "Paste LLM answer",
      guidance: "The pasted text does not include margins-file blocks yet. Paste the model's full Margins output."
    };
  }

  if (state.llmPromptCopied) {
    return {
      action: "paste",
      label: "Paste LLM answer",
      guidance: "The prompt is copied. Paste it into your LLM, then paste the returned files here."
    };
  }

  const failedPdfCount = state.files.filter((file) => file.type === "pdf" && !file.text).length;
  return {
    action: "prepareInboxSave",
    label: "Save and organize",
    guidance: failedPdfCount
      ? `${failedPdfCount} PDF${failedPdfCount === 1 ? "" : "s"} need to be attached in the LLM chat. The copied prompt will list them.`
      : state.currentFileMap
        ? "Organize the new source against the existing vault, then review the proposed changes."
        : "Organize the uploaded files, ask a few filing questions, then save the local vault."
  };
}

function llmBlockingWarningCount() {
  const warningsByPath = validateLlmFiles(state.llmFiles);
  return [...warningsByPath.values()].reduce((sum, warnings) => (
    sum + warnings.filter((warning) => /contentReference|Missing YAML|not valid JSON/i.test(warning)).length
  ), 0);
}

function renderVault() {
  const vault = state.vault;
  const fileMap = vaultToFiles(vault);

  els.exportBtn.disabled = false;
  els.copyBtn.disabled = false;
  els.stats.textContent = `${vault.manifest.counts.raw_sources} sources · ${vault.wiki.graph.nodes.length} nodes · ${vault.wiki.graph.edges.length} edges`;
  state.currentFileMap = fileMap;
  state.hasSavedCurrent = false;
  state.pendingSave = true;
  updateSaveButtonState();
  renderWikiFiles(fileMap);

  renderOperatingLayer(fileMap);
  els.commandsList.innerHTML = Object.entries(vault.operatingLayer.commands).map(([name, body]) => `
    <div class="mini-card"><strong>/${escapeHtml(name)}</strong><br><span>${escapeHtml(firstLine(body))}</span></div>
  `).join("");
  els.agentsList.innerHTML = Object.entries(vault.operatingLayer.agents).map(([name, body]) => `
    <div class="mini-card"><strong>${escapeHtml(name)}</strong><br><span>${escapeHtml(firstLine(body))}</span></div>
  `).join("");

  els.editList.className = "edit-list";
  els.editList.innerHTML = vault.editProposals.map((proposal) => `
    <div class="edit-card">
      <strong>${escapeHtml(proposal.title)}</strong>
      <span>${escapeHtml(proposal.operation)} · ${escapeHtml(proposal.target)}</span>
      <div>${escapeHtml(proposal.rationale)}</div>
    </div>
  `).join("");

  drawGraph(vault.wiki.graph);
  updateWorkflowState();
}

function renderOperatingLayer(fileMap) {
  els.operatorManual.textContent = fileMap.get("operator-manual.md") || "No operator manual found in this file set.";
  els.queryCookbook.textContent = fileMap.get("query-cookbook.md") || "No query cookbook found in this file set.";

  const commands = [...fileMap.entries()].filter(([path]) => path.startsWith("commands/") && path.endsWith(".md"));
  const agents = [...fileMap.entries()].filter(([path]) => path.startsWith("agents/") && path.endsWith(".md"));

  els.commandsList.innerHTML = commands.length
    ? commands.map(([path, body]) => `
      <div class="mini-card"><strong>/${escapeHtml(basename(path).replace(/\.md$/, ""))}</strong><br><span>${escapeHtml(firstLine(body))}</span></div>
    `).join("")
    : `<div class="mini-card"><strong>No commands</strong><br><span>Ask the LLM to return commands/*.md files when needed.</span></div>`;

  els.agentsList.innerHTML = agents.length
    ? agents.map(([path, body]) => `
      <div class="mini-card"><strong>${escapeHtml(basename(path).replace(/\.md$/, ""))}</strong><br><span>${escapeHtml(firstLine(body))}</span></div>
    `).join("")
    : `<div class="mini-card"><strong>No agents</strong><br><span>Ask the LLM to return agents/*.md files when needed.</span></div>`;
}

function renderAcceptedLlmEditState() {
  const editLog = state.currentFileMap.get("wiki/.margins/edit-log.jsonl") ||
    state.currentFileMap.get(".margins/edit-log.jsonl") ||
    "";
  const proposals = editLog
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseJsonLine)
    .filter(Boolean);

  if (proposals.length === 0) {
    els.editList.className = "edit-list empty";
    els.editList.textContent = "LLM files accepted. No structured edit proposals were returned.";
    return;
  }

  els.editList.className = "edit-list";
  els.editList.innerHTML = proposals.map((proposal) => `
    <div class="edit-card">
      <strong>${escapeHtml(proposal.title || proposal.operation || "Edit proposal")}</strong>
      <span>${escapeHtml(proposal.operation || "review")} · ${escapeHtml(proposal.target || "unknown target")}</span>
      <div>${escapeHtml(proposal.rationale || proposal.summary || "Review this proposed change before writing it locally.")}</div>
    </div>
  `).join("");
}

function renderWikiFiles(fileMap) {
  const entries = [...fileMap.entries()].filter(([path]) => isWikiPagePath(path));
  els.wikiTree.className = "tree-list";
  els.wikiTree.innerHTML = entries.map(([path, body]) => `
    <div class="tree-item" data-path="${escapeHtml(path)}">
      <strong>${escapeHtml(path)}</strong>
      <span>${wordCount(body)} words</span>
    </div>
  `).join("");

  els.wikiTree.querySelectorAll(".tree-item").forEach((item) => {
    item.addEventListener("click", () => {
      state.selectedPath = item.dataset.path;
      els.docTitle.textContent = state.selectedPath;
      els.docBody.textContent = fileMap.get(state.selectedPath);
    });
  });

  if (entries[0]) {
    state.selectedPath = entries[0][0];
    els.docTitle.textContent = entries[0][0];
    els.docBody.textContent = entries[0][1];
  } else {
    els.wikiTree.className = "tree-list empty";
    els.wikiTree.textContent = "No wiki Markdown files found.";
    els.docTitle.textContent = "No node selected";
    els.docBody.textContent = "Paste LLM output or compile sources to generate wiki nodes.";
  }
}

function renderLlmReview() {
  const entries = [...state.llmFiles.entries()];
  const warningsByPath = validateLlmFiles(state.llmFiles);
  const questions = buildMaterialQuestions(state.llmFiles, warningsByPath, state.reviewMode);
  state.currentMaterialQuestions = questions;
  const warningCount = [...warningsByPath.values()].reduce((sum, warnings) => sum + warnings.length, 0);
  els.acceptLlmBtn.disabled = entries.length === 0;
  els.repairLlmBtn.disabled = entries.length === 0 || warningCount === 0;
  els.llmStatus.textContent = entries.length
    ? `${entries.length} file${entries.length === 1 ? "" : "s"} parsed · ${warningCount} review warning${warningCount === 1 ? "" : "s"} · ${questions.length} material question${questions.length === 1 ? "" : "s"}`
    : "No files found. Paste output that uses ```margins-file path=\"...\" fenced blocks.";

  if (entries.length === 0) {
    els.llmFileList.className = "tree-list empty";
    els.llmFileList.textContent = "No parsed files.";
    els.llmPreviewTitle.textContent = "No LLM file selected";
    els.llmPreviewBody.textContent = "Paste model output, then click Parse LLM files.";
    renderMaterialQuestions([]);
    els.repairLlmBtn.disabled = true;
    updateReviewResponseState();
    updateWorkflowState();
    return;
  }

  els.llmFileList.className = "tree-list";
  els.llmFileList.innerHTML = entries.map(([path, body]) => `
    <div class="tree-item" data-path="${escapeHtml(path)}">
      <strong>${escapeHtml(path)}</strong>
      <span>${wordCount(body)} words${warningLabel(warningsByPath.get(path) || [])}</span>
    </div>
  `).join("");

  els.llmFileList.querySelectorAll(".tree-item").forEach((item) => {
    item.addEventListener("click", () => {
      state.llmSelectedPath = item.dataset.path;
      renderLlmPreview(warningsByPath);
    });
  });

  state.llmSelectedPath = entries[0][0];
  renderLlmPreview(warningsByPath);
  renderMaterialQuestions(questions);
  updateReviewResponseState();
  updateWorkflowState();
}

function renderLlmPreview(warningsByPath) {
  const body = state.llmFiles.get(state.llmSelectedPath) || "";
  const warnings = warningsByPath.get(state.llmSelectedPath) || [];
  els.llmPreviewTitle.textContent = warnings.length
    ? `${state.llmSelectedPath} · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`
    : state.llmSelectedPath;
  els.llmPreviewBody.textContent = warnings.length
    ? `Review warnings:\n${warnings.map((warning) => `- ${warning}`).join("\n")}\n\n${body}`
    : body;
}

function renderMaterialQuestions(questions) {
  if (questions.length === 0) {
    els.reviewQuestions.className = "review-list empty";
    els.reviewQuestions.textContent = state.reviewMode === "auto"
      ? "Auto-file mode: no material blockers found."
      : "No material review questions.";
    return;
  }

  els.reviewQuestions.className = "review-list";
  els.reviewQuestions.innerHTML = questions.map((question) => `
    <div class="review-card ${question.severity}" data-question="${escapeHtml(question.question)}">
      <div class="review-meta">${escapeHtml(question.kind)}</div>
      <strong>${escapeHtml(question.question)}</strong>
      <p>${escapeHtml(question.reason)}</p>
      <div class="recommendation">${escapeHtml(question.recommendation)}</div>
      <div class="quick-actions">
        ${(question.options || ["Yes", "No", "Use default"]).map((option, index) => `
          <button class="quick-answer ${index === 0 ? "primary" : ""}" type="button" data-answer="${escapeHtml(option)}">${escapeHtml(option)}</button>
        `).join("")}
      </div>
      <div class="review-path">${escapeHtml(question.path || "vault")}</div>
    </div>
  `).join("");

  els.reviewQuestions.querySelectorAll(".quick-answer").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest(".review-card");
      appendReviewAnswer(card.dataset.question, button.dataset.answer);
      card.classList.add("answered");
      card.querySelectorAll(".quick-answer").forEach((item) => {
        item.classList.toggle("selected", item === button);
      });
    });
  });
}

function appendReviewAnswer(question, answer) {
  const line = `- ${question}: ${answer}`;
  const current = els.reviewReply.value.trim();
  els.reviewReply.value = current ? `${current}\n${line}` : line;
  updateReviewResponseState();
  updateWorkflowState();
}

function updateReviewResponseState() {
  els.reviewResponseBtn.disabled = state.llmFiles.size === 0 || !els.reviewReply.value.trim();
}

function buildMaterialQuestions(fileMap, warningsByPath, mode) {
  if (mode === "auto") {
    return buildAutoFileQuestions(fileMap, warningsByPath);
  }

  const questions = [
    ...promotionQuestions(fileMap),
    ...synthesisQuestions(fileMap),
    ...riskQuestions(fileMap),
    ...rawSourceQuestions(fileMap)
  ];

  if (mode === "strict") {
    questions.push(...strictReviewQuestions(fileMap));
  }

  return dedupeQuestions(questions).slice(0, mode === "strict" ? 12 : 6);
}

function buildAutoFileQuestions(fileMap, warningsByPath) {
  const warningQuestions = [];
  for (const [path, warnings] of warningsByPath.entries()) {
    for (const warning of warnings) {
      if (/contentReference|Missing YAML|not valid JSON|raw source/i.test(warning)) {
        warningQuestions.push(reviewQuestion(
          "blocker",
          "I need to fix this first",
          path,
          "I found a formatting issue I should clean up before saving this.",
          warning,
          "My take: use the repair prompt first, then we can file the cleaned version."
        ));
      }
    }
  }
  return warningQuestions.slice(0, 4);
}

function promotionQuestions(fileMap) {
  const questions = [];
  for (const [path, body] of fileMap.entries()) {
    if (path.startsWith("wiki/entities/")) {
      const title = markdownTitle(body) || titleFromSlug(basename(path).replace(/\.md$/, ""));
      const demoLike = /\bdemo\b|\bfictional\b|\bplaceholder\b|\bnot an actual\b|\bexample\b/i.test(body);
      questions.push(reviewQuestion(
        demoLike ? "warn" : "suggest",
        "Quick check",
        path,
        demoLike
          ? `I found "${title}", but it looks like sample/demo data. Should I keep it tucked inside the source note instead of making it a main page?`
          : `I found "${title}" and I can make a page for it. Is this something you'll probably want to find again later?`,
        demoLike
          ? "I don't want to clutter your graph with fake clients, sample advisors, or placeholder companies."
          : "I usually make separate pages for real people, companies, projects, tools, accounts, or places that will matter again.",
        demoLike ? "My take: keep it in the source note unless you expect this name to come up again." : "My take: save it as a page if it's real and likely to come up again."
      ));
    }
    if (path.startsWith("wiki/concepts/")) {
      const title = markdownTitle(body) || titleFromSlug(basename(path).replace(/\.md$/, ""));
      questions.push(reviewQuestion(
        "suggest",
        "Quick check",
        path,
        `I found the theme "${title}". Do you want that to become a page I can connect future files to?`,
        "If this is just a label from one document, I can leave it inside the source note. If it's a recurring idea, a page will make future search and linking better.",
        "My take: save it if you can imagine asking about this topic later."
      ));
    }
  }
  return questions;
}

function synthesisQuestions(fileMap) {
  return [...fileMap.entries()]
    .filter(([path]) => path.startsWith("wiki/synthesis/"))
    .map(([path, body]) => reviewQuestion(
      "suggest",
      "Quick check",
      path,
      "I connected a few notes into a bigger-picture summary. Does that connection feel useful to keep?",
      "This is where the wiki becomes more than file summaries, but I only want to keep connections that actually help you think or retrieve later.",
      /\bnot directly stated\b|\bhypothesis\b|\bnot stated\b/i.test(body)
        ? "My take: keep it as a draft if the connection is useful, but don't treat it as fact yet."
        : "My take: keep it if it explains a real connection across files."
    ));
}

function riskQuestions(fileMap) {
  const sensitive = [];
  for (const [path, body] of fileMap.entries()) {
    if (!path.startsWith("wiki/sources/")) continue;
    if (/\b(account number|ssn|social security|medical|diagnosis|legal|attorney|customer|client|salary|tax|bank|routing)\b/i.test(body)) {
      sensitive.push(reviewQuestion(
        "warn",
        "Careful",
        path,
        "This file looks sensitive. Do you want me to slow down and review it more carefully before saving?",
        "I saw terms that often show up in financial, legal, medical, customer, or work files. A bad summary in those areas is more costly.",
        "My take: use Strict review here, or save only the source note if you're unsure."
      ));
    }
  }
  return sensitive;
}

function rawSourceQuestions() {
  if (state.files.length > 0) return [];
  return [reviewQuestion(
    "warn",
    "Before saving",
    "raw_sources/",
    "I don't have the original files loaded right now. Should I pause before saving the generated notes?",
    "The vault is much more trustworthy when it keeps the original files next to the notes I generated from them.",
    "My take: reload the original files first so I can save both."
  )];
}

function strictReviewQuestions(fileMap) {
  const sourceCount = [...fileMap.keys()].filter((path) => path.startsWith("wiki/sources/")).length;
  const promotedCount = [...fileMap.keys()].filter((path) => (
    path.startsWith("wiki/entities/") ||
    path.startsWith("wiki/concepts/") ||
    path.startsWith("wiki/synthesis/")
  )).length;
  if (sourceCount === 0 || promotedCount === 0) return [];
  return [reviewQuestion(
    "suggest",
    "Careful",
    "wiki/",
    "Since Strict review is on, do you want to approve the new pages one at a time before I save them?",
    "This is useful when the files are important enough that every new page should be intentional.",
    "My take: approve the new pages one by one."
  )];
}

function reviewQuestion(severity, kind, path, question, reason, recommendation, options = ["Yes", "No", "Use default"]) {
  return { severity, kind, path, question, reason, recommendation, options };
}

function dedupeQuestions(questions) {
  const seen = new Set();
  return questions.filter((question) => {
    const key = `${question.kind}:${question.path}:${question.question}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validateLlmFiles(fileMap) {
  const warningsByPath = new Map();
  const entries = [...fileMap.entries()];
  const promotedPages = entries.filter(([path]) => (
    path.startsWith("wiki/concepts/") ||
    path.startsWith("wiki/entities/") ||
    path.startsWith("wiki/synthesis/")
  ));
  const hasPromotedPages = promotedPages.length > 0;

  for (const [path, body] of entries) {
    const warnings = [];
    if (isWikiPagePath(path) && !hasYamlFrontmatter(body)) {
      warnings.push("Missing YAML frontmatter.");
    }
    if (/:contentReference\[|oaicite:/i.test(body)) {
      warnings.push("Contains ChatGPT contentReference citations. Replace with durable source/file citations.");
    }
    if (path.startsWith("wiki/sources/")) {
      if (!/##\s+Mentioned but missing/i.test(body)) warnings.push("Source page is missing a Mentioned but missing section.");
      if (!/##\s+Inferences refused/i.test(body)) warnings.push("Source page is missing an Inferences refused section.");
      if (hasPromotedPages && extractWikiLinks(body).length === 0) {
        warnings.push("Source page does not link to promoted concepts, entities, or synthesis pages.");
      }
    }
    if ((path.startsWith("wiki/concepts/") || path.startsWith("wiki/entities/") || path.startsWith("wiki/synthesis/")) && !body.includes("[[source-")) {
      warnings.push("Promoted page does not link back to a source page.");
    }
    if (path.startsWith("wiki/entities/") && /\bfictional\b|\bdemo\b|\bis this a real\b/i.test(body)) {
      warnings.push("Entity may be fictional or demo-only. Review before keeping it as a first-class entity.");
    }
    if (path === "wiki/.margins/edit-log.jsonl" || path === ".margins/edit-log.jsonl") {
      const invalidLines = body.split("\n").filter((line) => line.trim() && !parseJsonLine(line));
      if (invalidLines.length > 0) warnings.push(`${invalidLines.length} edit-log line${invalidLines.length === 1 ? "" : "s"} are not valid JSON.`);
    }
    warningsByPath.set(path, warnings);
  }

  return warningsByPath;
}

function hasYamlFrontmatter(body) {
  return /^---\n[\s\S]+?\n---\n/.test(body);
}

function isWikiPagePath(path) {
  return (/^wiki\/(sources|concepts|entities|synthesis)\/[^/]+\.md$/.test(path) || path === "wiki/index.md");
}

function warningLabel(warnings) {
  return warnings.length ? ` · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : "";
}

function drawGraph(graph) {
  const width = 980;
  const height = 560;
  if (!graph || graph.nodes.length === 0) {
    els.graphSvg.innerHTML = `<text class="node-label" x="${width / 2}" y="${height / 2}" text-anchor="middle">No accepted graph nodes yet.</text>`;
    return;
  }
  const cx = width / 2;
  const cy = height / 2;
  const radius = 210;
  const nodes = graph.nodes.map((node, index) => {
    const angle = (index / Math.max(graph.nodes.length, 1)) * Math.PI * 2;
    return {
      ...node,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));

  const edgeSvg = graph.edges.map((edge) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) return "";
    return `<line class="edge" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" />`;
  }).join("");

  const nodeSvg = nodes.map((node) => `
    <g>
      <circle cx="${node.x}" cy="${node.y}" r="${nodeRadius(node.type)}" fill="${nodeColor(node.type)}" />
      <text class="node-label" x="${node.x + 11}" y="${node.y + 4}">${escapeHtml(shortLabel(node.title))}</text>
    </g>
  `).join("");

  els.graphSvg.innerHTML = `${edgeSvg}${nodeSvg}`;
}

function graphFromFileMap(fileMap) {
  const nodeEntries = [...fileMap.entries()]
    .filter(([path]) => isGraphNodePath(path))
    .map(([path, body]) => nodeFromMarkdownFile(path, body));
  const nodes = nodeEntries.map(({ node }) => node);
  const bySlug = new Map();
  const byPath = new Map();

  for (const entry of nodeEntries) {
    byPath.set(entry.path, entry.node);
    bySlug.set(entry.slug, entry.node);
    bySlug.set(entry.node.id, entry.node);
    bySlug.set(slugifyLoose(entry.node.title), entry.node);
  }

  const edges = [];
  const seen = new Set();
  for (const { path, body, node } of nodeEntries) {
    for (const target of extractWikiLinks(body)) {
      const to = resolveGraphLink(target, byPath, bySlug);
      if (!to || to.id === node.id) continue;
      const key = `${node.id}->${to.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: node.id, to: to.id, type: "wiki-link" });
    }
  }

  const graph = { nodes, edges };
  els.stats.textContent = `${fileMap.size} accepted file${fileMap.size === 1 ? "" : "s"} · ${nodes.length} reviewed nodes · ${edges.length} cited links`;
  return graph;
}

function nodeFromMarkdownFile(path, body) {
  const slug = basename(path).replace(/\.md$/, "");
  const id = path.replace(/^wiki\//, "").replace(/\.md$/, "");
  return {
    path,
    body,
    slug,
    node: {
      id,
      type: graphTypeFromPath(path),
      title: markdownTitle(body) || titleFromSlug(slug)
    }
  };
}

function isGraphNodePath(path) {
  return /^wiki\/(sources|concepts|entities|synthesis)\/[^/]+\.md$/.test(path) || path === "wiki/index.md";
}

function graphTypeFromPath(path) {
  if (path.startsWith("wiki/sources/")) return "source";
  if (path.startsWith("wiki/concepts/")) return "concept";
  if (path.startsWith("wiki/entities/")) return "entity";
  if (path.startsWith("wiki/synthesis/")) return "synthesis";
  return "index";
}

function extractWikiLinks(body) {
  const links = [];
  const pattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    links.push(match[1].trim());
  }
  return links;
}

function resolveGraphLink(target, byPath, bySlug) {
  const trimmed = target.replace(/^\//, "").replace(/\.md$/, "");
  const pathCandidates = [
    target,
    `${trimmed}.md`,
    `wiki/sources/${trimmed}.md`,
    `wiki/concepts/${trimmed}.md`,
    `wiki/entities/${trimmed}.md`,
    `wiki/synthesis/${trimmed}.md`
  ];

  for (const candidate of pathCandidates) {
    const node = byPath.get(candidate);
    if (node) return node;
  }

  return bySlug.get(slugifyLoose(trimmed)) || bySlug.get(trimmed);
}

async function readBrowserFile(file) {
  const isPdf = /\.pdf$/i.test(file.name);
  return {
    name: file.webkitRelativePath || file.name,
    text: isPdf ? "" : await file.text(),
    browserFile: file,
    type: isPdf ? "pdf" : "text",
    extractionStatus: isPdf ? "needed" : "ready",
    extractionError: ""
  };
}

async function extractPdfSources() {
  const targets = state.files.filter((file) => file.type === "pdf" && file.extractionStatus !== "extracted");
  if (targets.length === 0) return;

  els.extractBtn.disabled = true;
  els.extractBtn.textContent = "Extracting PDFs...";
  state.vault = null;
  state.selectedPath = null;
  updateWorkflowState();

  for (const file of targets) {
    file.extractionStatus = "extracting";
    file.extractionError = "";
    renderSources();

    try {
      const text = await extractPdfText(file.browserFile);
      file.text = text.trim();
      file.extractionStatus = file.text ? "extracted" : "failed";
      if (!file.text) file.extractionError = "No selectable text found.";
    } catch (error) {
      file.text = "";
      file.extractionStatus = "failed";
      file.extractionError = error.message || "PDF extraction failed.";
    }
  }

  els.extractBtn.textContent = "Extract PDF text";
  renderSources();
  updateActionState();
  els.stats.textContent = state.currentFileMap
    ? `${state.files.length} new source${state.files.length === 1 ? "" : "s"} ready · existing wiki retained`
    : `${state.files.length} source${state.files.length === 1 ? "" : "s"} loaded · 0 nodes · 0 edges`;
  updateWorkflowState();
}

async function extractPdfText(file) {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => item.str || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) pages.push(`Page ${pageNumber}\n${text}`);
  }

  return pages.join("\n\n");
}

function updateActionState() {
  const hasFiles = state.files.length > 0;
  const hasPendingPdf = state.files.some((file) => file.type === "pdf" && file.extractionStatus !== "extracted");
  els.extractBtn.disabled = !hasPendingPdf;
  els.compileBtn.disabled = !hasFiles;
  els.llmBtn.disabled = !hasFiles;
  updateSaveButtonState();
  updateWorkflowState();
}

function updateSaveButtonState() {
  if (!els.saveVaultBtn) return;
  const canPrepare = state.files.length > 0 && !state.pendingSave;
  const canSave = state.pendingSave && state.currentFileMap;
  els.saveVaultBtn.disabled = !(canPrepare || canSave);
  els.saveVaultBtn.textContent = canSave ? "Write local vault" : "Save and organize";
}

function sourceClass(file) {
  if (file.text) return "";
  if (file.type === "pdf") return "needs-extraction";
  return "";
}

function sourceStatus(file) {
  const prefix = file.sourceScope === "pending" ? "new · " : file.sourceScope === "vault" ? "in vault · " : "";
  if (file.text) {
    const suffix = file.type === "pdf" ? " extracted" : "";
    return `${prefix}${wordCount(file.text)} words${suffix}`;
  }
  if (file.type === "pdf" && file.extractionStatus === "extracting") return `${prefix}extracting text...`;
  if (file.type === "pdf" && file.extractionStatus === "failed") {
    return `${prefix}extraction failed: ${file.extractionError || "needs text extraction or LLM attachment"}`;
  }
  if (file.type === "pdf") return `${prefix}needs text extraction or LLM attachment`;
  return `${prefix}0 words`;
}

function normalizeSelectedFiles(files) {
  const seen = new Set();
  const normalized = [];

  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    if (!path || shouldIgnorePath(path)) continue;

    const key = `${path}::${file.size}::${file.lastModified}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(file);
  }

  return normalized.sort((a, b) => {
    const left = a.webkitRelativePath || a.name;
    const right = b.webkitRelativePath || b.name;
    return left.localeCompare(right);
  });
}

function buildLlmIngestPrompt(files, existingFileMap = null) {
  const textFiles = files.filter((file) => file.text.trim());
  const attachmentFiles = files.filter((file) => !file.text.trim());
  const attachmentList = attachmentFiles.map((file) => `- ${file.name}`).join("\n") || "- none";
  const sourceBlocks = textFiles.map((file) => (
    `## Source: ${file.name}\n\n${file.text.trim()}`
  )).join("\n\n---\n\n") || "_No extracted text sources were available._";
  const incremental = existingFileMap && hasVaultWikiContent(existingFileMap);
  const existingVaultContext = incremental
    ? `\n\nCurrent vault context:\nThe following files already exist in the user's vault. Treat them as the current wiki state. Preserve them unless the new source requires a specific update.\n\n${serializeVaultContext(existingFileMap)}`
    : "";
  const outputMode = incremental
    ? `This is an incremental ingest into an existing vault. Return only files that should be created or replaced. Margins will merge returned files into the current vault. Include wiki/index.md, wiki/.margins/manifest.json, wiki/.margins/ingest-report.md, wiki/.margins/edit-log.jsonl, and any existing concept/entity/synthesis/source pages only if they need updates. Do not return unchanged files.`
    : `This is a fresh ingest. Return the complete starter file set for the vault.`;

  return `You are operating Margins, a local-first personal wiki compiler.

Goal:
Turn raw sources into a useful wiki, not a chat transcript and not a generic file organizer. Preserve raw sources as evidence. Create source pages first, then only create durable concept/entity/synthesis pages when the source material actually supports them.

Mode:
${outputMode}

Use this operating context as law:

${wikiSchemaPack()}
${existingVaultContext}

The model behavior should match this operating philosophy:
- The wiki is the user's external memory. Correct recall matters more than producing many nodes.
- Source pages are faithful direct reads. Synthesis is allowed only when labeled.
- The best graph is conservative: fewer true links beat many weak links.
- Do not infer silently. If a relationship, role, date, amount, intent, next move, or strategic implication is not a direct read, flag it as an open question or Claude synthesis.
- If you considered an inference but did not write it as fact, list it in an "Inferences refused" section.

Important:
- The following files did not expose text in the browser and must be attached or extracted before you summarize them:
${attachmentList}
- Do not pretend to have read an attachment unless it is actually available in this conversation.
- If a source is unavailable, create a source placeholder and mark it "needs text extraction".

Output format:
Return Markdown files in this exact fenced-block format so Margins can parse them:

\`\`\`margins-file path="wiki/sources/source-example.md"
---
type: source
bucket: sources
summary: One sentence direct-read summary.
tags: [source]
created: YYYY-MM-DD
updated: YYYY-MM-DD
voice: claude-draft
---

# Source: Example

Markdown body here.
\`\`\`

Use one fenced block per returned file. Use this structure:
- wiki/sources/source-{slug}.md
- wiki/concepts/{slug}.md
- wiki/entities/{slug}.md
- wiki/synthesis/{slug}.md
- wiki/index.md
- operator-manual.md
- query-cookbook.md
- commands/ingest.md
- commands/query.md
- commands/compile.md
- commands/lint.md
- commands/propose-edit.md
- commands/apply-edit.md
- agents/wiki-ingest.md
- agents/wiki-compiler.md
- agents/wiki-query.md
- agents/wiki-editor.md
- wiki/.margins/manifest.json
- wiki/.margins/ingest-report.md
- wiki/.margins/edit-log.jsonl

Page rules:
- Every source, concept, entity, synthesis, and index Markdown page under wiki/ must start with YAML frontmatter. Operational files under wiki/.margins/ do not need page frontmatter.
- Every factual claim needs a durable source citation. Do not use ChatGPT-only citation tokens such as :contentReference, oaicite, turn references, or hidden attachment ids. Cite with source page links and plain file/section references that will still make sense after export.
- Synthesis is allowed, but label it as synthesis.
- Do not invent account balances, transaction details, dates, roles, or relationships.
- Prefer useful connection-point summaries over generic tags.
- Only create concept pages for durable ideas that will remain useful across future sources.
- Only create entity pages for real people, organizations, named accounts, tools, securities, projects, or places.
- Do not create concept/entity pages for generic labels, PDF artifacts, table headers, UI labels, or section names such as page, positions, spec, inch, flow, append, value, account, or description.
- Treat "positions" as source content or a synthesis section unless the source names a specific position that matters.
- Add wiki links only when the relationship is explicit and useful. Weak keyword overlap should stay unlinked.
- Make edit proposals before changing important structure.
- Use wiki links for source-supported proper nouns and durable pages only.
- When you create a concept, entity, or synthesis page, add backlinks from the relevant source pages using [[page-slug]] links so the graph is navigable.
- Promoted concept/entity/synthesis pages must link back to their supporting source pages.
- Do not create stub pages just to resolve a mention. Put those in "Mentioned but missing" instead.

For each source:
1. Write a faithful source page with frontmatter, summary, context, key takeaways, concrete facts, and open questions.
2. Extract concrete entities, dates, accounts, projects, decisions, and unresolved questions, but keep weak candidates inside the source page.
3. Identify concepts that should become durable wiki pages. A concept should be reusable across future sources, not just a word that appeared in this file.
4. Add a "Mentioned but missing" section for proper nouns that might need pages but should not be auto-promoted.
5. Add an "Inferences refused" section for tempting claims you did not promote because the source does not directly support them.

Across sources:
1. Link related source nodes only when the connection is explicit or strongly source-supported.
2. Create synthesis pages that explain why sources connect, and label them as synthesis / not user-confirmed.
3. Create entity pages only for real named people, organizations, named accounts, tools, securities, projects, or places that matter.
4. Create concept pages only for load-bearing ideas that will help future retrieval.
5. List open questions and next actions separately from direct-read facts.

Operating-layer files:
- operator-manual.md should teach a future language model how to read, query, edit, and avoid overreaching in this wiki.
- query-cookbook.md should include practical lookup patterns.
- commands/*.md should be short executable workflow specs.
- agents/*.md should describe conservative recurring roles: ingest, compile, query, and editor.
- wiki/.margins/manifest.json should describe the vault template, privacy posture, enabled commands, enabled agents, and generated counts.
- wiki/.margins/ingest-report.md should summarize files created, links made, inferences refused, mentioned-but-missing candidates, and anything that needs user review.

Extracted text sources:

${sourceBlocks}`;
}

function serializeVaultContext(fileMap) {
  const entries = [...fileMap.entries()]
    .filter(([path]) => shouldIncludeInVaultContext(path))
    .sort(([left], [right]) => contextPathRank(left) - contextPathRank(right) || left.localeCompare(right));

  return entries.map(([path, body]) => {
    const budget = path.startsWith("wiki/sources/") ? 2400 : 1800;
    return `\`\`\`margins-file path="${path}"\n${truncateForPrompt(body, budget)}\n\`\`\``;
  }).join("\n\n") || "_No existing wiki context was loaded._";
}

function shouldIncludeInVaultContext(path) {
  return isWikiPagePath(path) ||
    path.startsWith("commands/") ||
    path.startsWith("agents/") ||
    path === "operator-manual.md" ||
    path === "query-cookbook.md" ||
    path === "wiki/.margins/ingest-report.md";
}

function contextPathRank(path) {
  if (path === "wiki/index.md") return 0;
  if (path.startsWith("wiki/sources/")) return 1;
  if (path.startsWith("wiki/concepts/")) return 2;
  if (path.startsWith("wiki/entities/")) return 3;
  if (path.startsWith("wiki/synthesis/")) return 4;
  return 5;
}

function truncateForPrompt(body, maxChars) {
  if (body.length <= maxChars) return body;
  return `${body.slice(0, maxChars).trim()}\n\n[Truncated for prompt. Preserve this file unless the new source clearly requires an update.]`;
}

function wikiSchemaPack() {
  return `## Margins Wiki Schema Pack

Architecture:
- raw_sources/ stores immutable evidence.
- wiki/ stores LLM-operable Markdown: source pages, concept pages, entity pages, synthesis pages, and index pages.
- operator-manual.md, query-cookbook.md, commands/, agents/, and wiki/.margins/ tell future models how to operate the wiki.

Required frontmatter for wiki source, concept, entity, synthesis, and index pages:
---
type: source | concept | entity | synthesis | index
bucket: sources | concepts | entities | synthesis | index
summary: One sentence direct-read summary.
tags: [source]
created: YYYY-MM-DD
updated: YYYY-MM-DD
voice: claude-draft
---

Citation rules:
- Use durable wiki/file citations only.
- Good: "Ending value was $40,053.97 (source file: coleman-brokerage-2026-03.pdf, Account Summary)."
- Good: "See [[source-coleman-brokerage-2026-03]]."
- Bad: ":contentReference[oaicite:10]{index=10}", hidden attachment ids, turn ids, or any citation that disappears outside the chat.

Good source page shape:
---
type: source
bucket: sources
summary: Demo brokerage statement for Sarah Coleman covering March 2026 account values, allocation, holdings, and withdrawals.
tags: [source, statement, demo]
created: YYYY-MM-DD
updated: YYYY-MM-DD
event_date: 2026-03-31
voice: claude-draft
---

# Source: Coleman Brokerage Statement, March 2026

Raw file: coleman-brokerage-2026-03.pdf

## Summary
Direct-read summary with durable citations to the raw file or source page.

## Context
- Link durable promoted pages when supported: [[demo-financial-statements]]

## Concrete Facts
- Fact with raw file / section citation.

## Related Pages
- [[demo-financial-statements]] -- why this page connects

## Mentioned but missing
- Candidate -- why it was not promoted

## Inferences refused
- Tempting unsupported claim -- why it stayed out

Good promoted page rule:
- A concept/entity/synthesis page must link back to supporting sources with [[source-slug]].
- Do not promote demo-only names unless the name itself will help future retrieval.

Good ingest report shape:
# Ingest Report

## Files Created
## Links Made
## Inferences Refused
## Mentioned but Missing
## Needs Review

Self-check before returning:
1. Every wiki source, concept, entity, synthesis, and index page has YAML frontmatter.
2. No ChatGPT-only citation artifacts remain.
3. Every source page has Mentioned but missing and Inferences refused.
4. Every promoted page links back to a source page.
5. Source pages link to promoted pages where supported.
6. Fictional/demo-only names are not promoted unless useful durable entities.`;
}

function buildLlmRepairPrompt(fileMap) {
  const warningsByPath = validateLlmFiles(fileMap);
  const groupedWarnings = [...warningsByPath.entries()]
    .filter(([, warnings]) => warnings.length > 0)
    .map(([path, warnings]) => `## ${path}\n${warnings.map((warning) => `- ${warning}`).join("\n")}`)
    .join("\n\n") || "No warnings.";

  return `Repair this Margins wiki output.

Use this operating context as law:

${wikiSchemaPack()}

Your task:
1. Regenerate the complete returned file set, not a diff patch.
2. Keep the exact \`\`\`margins-file path="..."\`\`\` fenced block format.
3. Fix every warning listed below.
4. Remove all :contentReference, oaicite, hidden attachment ids, and turn references.
5. Add YAML frontmatter to every wiki source, concept, entity, synthesis, and index page.
6. Use durable citations only: source page links, raw filenames, and plain section names.
7. Add source-page backlinks to promoted pages where supported.
8. Demote fictional/demo-only entity pages into Mentioned but missing or Needs Review unless they are useful durable entities.
9. Preserve good source facts and refused inferences.

Review warnings:

${groupedWarnings}

Current output to repair:

${serializeLlmFiles(fileMap)}`;
}

function buildReviewResponsePrompt(fileMap, questions, reply, reviewMode) {
  return `You are operating Margins, a local-first personal wiki compiler.

The user is responding conversationally to review questions about generated wiki files. Use their reply as judgment, then regenerate the complete returned file set.

Current review mode: ${reviewModeLabel(reviewMode)}

Operating context:

${wikiSchemaPack()}

Review questions Margins asked:

${serializeReviewQuestions(questions)}

User reply:

${reply}

Task:
1. Apply the user's guidance conservatively to the wiki files below.
2. Return complete replacement contents for each file you return, not a diff patch.
3. Keep the exact \`\`\`margins-file path="..."\`\`\` fenced block format.
4. Prefer fewer, stronger concept/entity/synthesis pages over many weak pages.
5. Demote nodes the user does not want into source-page sections, "Mentioned but missing", or draft synthesis notes as appropriate.
6. Preserve source pages and concrete facts unless the user explicitly says they are wrong.
7. Keep all synthesis labeled. Do not turn guesses into facts.
8. If the user's reply contains a stable preference for future ingests, create or update wiki/.margins/preferences.json with a concise machine-readable preference.
9. Only add a follow-up question if the user's answer is needed to avoid a wrong durable wiki decision.

Current file set:

${serializeLlmFiles(fileMap)}`;
}

function serializeReviewQuestions(questions) {
  if (!questions.length) {
    return "- No material questions were generated. The user is giving optional filing guidance.";
  }
  return questions.map((question) => [
    `- ${question.question}`,
    `  Why Margins asked: ${question.reason}`,
    `  ${question.recommendation}`,
    `  File: ${question.path || "vault"}`
  ].join("\n")).join("\n");
}

function reviewModeLabel(mode) {
  return {
    auto: "Auto-file",
    suggested: "Suggested review",
    strict: "Strict review"
  }[mode] || mode;
}

function parseLlmFiles(value) {
  const files = new Map();
  const pattern = /```margins-file\s+path="([^"]+)"\s*\n([\s\S]*?)```/g;
  let match;

  while ((match = pattern.exec(value)) !== null) {
    const path = normalizeMarginsPath(match[1].trim());
    const body = match[2].trim();
    if (path && body) files.set(path, body);
  }

  return files;
}

function serializeLlmFiles(fileMap) {
  return [...fileMap.entries()]
    .map(([path, body]) => `\`\`\`margins-file path="${path}"\n${body}\n\`\`\``)
    .join("\n\n");
}

function activateTab(view) {
  document.querySelectorAll(".tab").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((item) => {
    item.classList.toggle("active", item.id === `${view}-view`);
  });
}

function shouldIgnorePath(path) {
  const parts = path.split("/");
  if (parts.includes("sample") && parts.includes("output")) return true;
  return parts.some((part) => (
    part.startsWith(".") ||
    part === "node_modules" ||
    part === "output" ||
    part === "dist" ||
    part === "build"
  ));
}

function download(name, body) {
  const blob = new Blob([body], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

async function scaffoldVault(rootHandle) {
  await ensureDirectory(rootHandle, "raw_sources");
  await ensureDirectory(rootHandle, "wiki/sources");
  await ensureDirectory(rootHandle, "wiki/concepts");
  await ensureDirectory(rootHandle, "wiki/entities");
  await ensureDirectory(rootHandle, "wiki/synthesis");
  await ensureDirectory(rootHandle, "commands");
  await ensureDirectory(rootHandle, "agents");
  await ensureDirectory(rootHandle, "wiki/.margins");
  await writeTextFileIfMissing(rootHandle, "raw_sources/README.md", `# Raw Sources

Drop original source files here. Margins treats this folder as evidence and writes generated knowledge into wiki/.
`);
  await writeTextFileIfMissing(rootHandle, "wiki/index.md", `---
type: index
bucket: index
summary: Index for this Margins vault.
tags: [index]
created: ${todayString()}
updated: ${todayString()}
voice: claude-draft
---

# Wiki Index

Save generated wiki files from Margins to populate this vault.
`);
  await writeTextFileIfMissing(rootHandle, "operator-manual.md", "# Operator Manual\n\nMargins will write model operating instructions here.\n");
  await writeTextFileIfMissing(rootHandle, "query-cookbook.md", "# Query Cookbook\n\nMargins will write query recipes here.\n");
  await writeTextFileIfMissing(rootHandle, "wiki/.margins/manifest.json", JSON.stringify({
    name: "Margins Vault",
    template: "karpathy-original",
    version: "0.1.0",
    created_at: new Date().toISOString(),
    storage: "local-folder"
  }, null, 2));
}

async function ensureDirectory(rootHandle, path) {
  const parts = safeRelativePath(path).split("/").filter(Boolean);
  let dir = rootHandle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}

async function directoryHandleForPath(rootHandle, path, create = true) {
  const parts = safeRelativePath(path).split("/").filter(Boolean);
  let dir = rootHandle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

async function readVaultFileMap(rootHandle) {
  const fileMap = new Map();
  await readDirectoryTextFiles(rootHandle, ".margins", fileMap);
  await readDirectoryTextFiles(rootHandle, "wiki", fileMap);
  await readDirectoryTextFiles(rootHandle, "commands", fileMap);
  await readDirectoryTextFiles(rootHandle, "agents", fileMap);
  await readRootTextFile(rootHandle, "operator-manual.md", fileMap);
  await readRootTextFile(rootHandle, "query-cookbook.md", fileMap);
  return fileMap;
}

async function readRawSourcesFromVault(rootHandle) {
  const files = [];
  await readRawSourceDirectory(rootHandle, "raw_sources", files);
  return files;
}

async function readDirectoryTextFiles(rootHandle, path, fileMap) {
  let dir;
  try {
    dir = await directoryHandleForPath(rootHandle, path, false);
  } catch {
    return;
  }

  for await (const [name, handle] of dir.entries()) {
    const childPath = `${path}/${name}`;
    if (handle.kind === "directory") {
      await readDirectoryTextFiles(rootHandle, childPath, fileMap);
    } else if (isVaultTextPath(childPath)) {
      const normalizedPath = normalizeMarginsPath(childPath);
      fileMap.set(normalizedPath, await readTextHandle(handle));
    }
  }
}

async function readRootTextFile(rootHandle, path, fileMap) {
  try {
    const fileHandle = await fileHandleForPath(rootHandle, path, false);
    fileMap.set(path, await readTextHandle(fileHandle));
  } catch {
    // Missing operating files are allowed for partially created vaults.
  }
}

async function readRawSourceDirectory(rootHandle, path, files) {
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
      files.push(await rawSourceFromFileHandle(handle, childPath.replace(/^raw_sources\//, "")));
    }
  }
}

async function rawSourceFromFileHandle(fileHandle, name) {
  const file = await fileHandle.getFile();
  const isPdf = /\.pdf$/i.test(name);
  let text = "";
  if (!isPdf && isVaultTextPath(name)) {
    try {
      text = await file.text();
    } catch {
      text = "";
    }
  }
  return {
    name,
    text,
    browserFile: file,
    type: isPdf ? "pdf" : "text",
    extractionStatus: isPdf ? "needed" : "ready",
    extractionError: "",
    sourceScope: "vault"
  };
}

async function readTextHandle(fileHandle) {
  const file = await fileHandle.getFile();
  return file.text();
}

function isVaultTextPath(path) {
  return /\.(md|txt|json|jsonl)$/i.test(path);
}

async function writeRawSources(rootHandle, files) {
  if (files.length === 0) {
    await writeTextFile(rootHandle, "raw_sources/README.md", `# Raw Sources

No raw source files were loaded in the browser when this Margins folder was written.

To preserve raw evidence, reload the original files in Margins before clicking "Save changes." Browsers clear selected file handles after refresh for security.
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

function rawSourceOutputPath(path) {
  const safePath = safeRelativePath(path);
  return safePath.startsWith("raw_sources/")
    ? safePath
    : `raw_sources/${safePath}`;
}

async function writeFileMap(rootHandle, fileMap) {
  let count = 0;
  for (const [path, body] of fileMap.entries()) {
    await writeTextFile(rootHandle, safeRelativePath(normalizeMarginsPath(path)), body);
    count += 1;
  }
  return count;
}

async function writeTextFile(rootHandle, path, body) {
  const fileHandle = await fileHandleForPath(rootHandle, path);
  const writable = await fileHandle.createWritable();
  await writable.write(body);
  await writable.close();
}

async function writeTextFileIfMissing(rootHandle, path, body) {
  try {
    await fileHandleForPath(rootHandle, path, false);
  } catch {
    await writeTextFile(rootHandle, path, body);
  }
}

async function writeBlobFile(rootHandle, path, blob) {
  const fileHandle = await fileHandleForPath(rootHandle, path);
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function fileHandleForPath(rootHandle, path, create = true) {
  const parts = safeRelativePath(path).split("/").filter(Boolean);
  const fileName = parts.pop();
  let dir = rootHandle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir.getFileHandle(fileName || "untitled.md", { create });
}

function safeRelativePath(path) {
  return String(path)
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => part.replace(/[<>:"|?*\u0000-\u001F]/g, "-"))
    .join("/");
}

function normalizeMarginsPath(path) {
  return String(path).replace(/^\.margins\//, "wiki/.margins/");
}

function wordCount(text) {
  return (text.match(/\S+/g) || []).length;
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function firstLine(text) {
  return text.split("\n").find((line) => line.trim() && !line.startsWith("#")) || "";
}

function basename(path) {
  return path.split("/").pop() || path;
}

function markdownTitle(body) {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

function titleFromSlug(slug) {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function slugifyLoose(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nodeColor(type) {
  return {
    source: "#b8b1a4",
    concept: "#6a4f8c",
    entity: "#2c5aa0",
    synthesis: "#b83a2f"
  }[type] || "#20201d";
}

function nodeRadius(type) {
  return type === "synthesis" ? 10 : type === "source" ? 7 : 8;
}

function shortLabel(label) {
  return label.length > 28 ? `${label.slice(0, 25)}...` : label;
}
