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
const API_GUARD_STORAGE_KEY = "margins.apiGuard.v1";
let apiSecretHydrationPromise = null;

const state = {
  files: [],
  editedRawFiles: new Map(),
  vaultFiles: [],
  vault: null,
  selectedPath: null,
  selectedKind: "",
  currentFileMap: null,
  loadedFileMap: new Map(),
  theme: initialTheme,
  reviewMode: localStorage.getItem("margins-review-mode") || "suggested",
  llmFiles: new Map(),
  llmSelectedPath: null,
  currentMaterialQuestions: [],
  llmPromptCopied: false,
  hasSavedCurrent: false,
  hasUnsavedEdits: false,
  pendingSave: false,
  processingInbox: false,
  processingFileName: "",
  vaultHandle: null,
  rememberedVaultHandle: null,
  vaultName: "",
  apiSettings: loadApiSettings(),
  apiSecret: localStorage.getItem(API_SECRET_STORAGE_KEY) || "",
  apiGuardSettings: loadApiGuardSettings(),
  apiUsage: emptyApiUsage(),
  apiQuestionSource: "",
  ingestReviews: new Map(),
  ingestAnswers: new Map(),
  ingestErrors: new Map(),
  lastProcessedReviewNames: [],
  expandedSummaries: new Set()
};

const apiThrottle = {
  queue: Promise.resolve(),
  lastStartedAt: 0,
  startedAt: []
};

const graphView = {
  width: 1120,
  height: 700,
  nodes: [],
  edges: [],
  transform: { x: 0, y: 0, k: 1 },
  selectedId: "",
  hoverId: "",
  alpha: 0,
  raf: 0,
  pointer: null,
  bound: false
};

const els = {
  themeToggle: document.getElementById("theme-toggle"),
  themeToggleLabel: document.getElementById("theme-toggle-label"),
  vaultStatus: document.getElementById("vault-status"),
  vaultTree: document.getElementById("vault-tree"),
  apiProvider: document.getElementById("api-provider"),
  apiModel: document.getElementById("api-model"),
  apiKey: document.getElementById("api-key"),
  saveApiKeyBtn: document.getElementById("save-api-key-btn"),
  clearApiKeyBtn: document.getElementById("clear-api-key-btn"),
  apiKeyStatus: document.getElementById("api-key-status"),
  apiGuardEnabled: document.getElementById("api-guard-enabled"),
  apiMaxRequests: document.getElementById("api-max-requests"),
  apiMaxOutputTokens: document.getElementById("api-max-output-tokens"),
  apiMaxSessionTokens: document.getElementById("api-max-session-tokens"),
  apiMaxSessionUsd: document.getElementById("api-max-session-usd"),
  apiMinRequestDelay: document.getElementById("api-min-request-delay"),
  apiMaxWindowRequests: document.getElementById("api-max-window-requests"),
  resetApiUsageBtn: document.getElementById("reset-api-usage-btn"),
  apiGuardStatus: document.getElementById("api-guard-status"),
  inlineReviewPanel: document.getElementById("inline-review-panel"),
  workflowGuidance: document.getElementById("workflow-guidance"),
  workflowBtn: document.getElementById("workflow-btn"),
  sourceDropZone: document.getElementById("source-drop-zone"),
  folderInput: document.getElementById("folder-input"),
  fileInput: document.getElementById("file-input"),
  queuePanel: document.getElementById("queue-panel"),
  sourceList: document.getElementById("source-list"),
  extractBtn: document.getElementById("extract-btn"),
  compileBtn: document.getElementById("compile-btn"),
  llmBtn: document.getElementById("llm-btn"),
  createVaultBtn: document.getElementById("create-vault-btn"),
  openVaultBtn: document.getElementById("open-vault-btn"),
  saveVaultBtn: document.getElementById("save-vault-btn"),
  bulkIngestBtn: document.getElementById("bulk-ingest-btn"),
  reviewMode: document.getElementById("review-mode"),
  reviewModeHelp: document.getElementById("review-mode-help"),
  exportBtn: document.getElementById("export-btn"),
  copyBtn: document.getElementById("copy-btn"),
  wikiTree: document.getElementById("wiki-tree"),
  vaultTreeCount: document.getElementById("vault-tree-count"),
  docPath: document.getElementById("doc-path"),
  docTitle: document.getElementById("doc-title"),
  docMeta: document.getElementById("doc-meta"),
  docHighlight: document.getElementById("doc-highlight"),
  docBody: document.getElementById("doc-body"),
  docSaveBtn: document.getElementById("doc-save-btn"),
  graphSvg: document.getElementById("graph-svg"),
  graphSelection: document.getElementById("graph-selection"),
  graphSelectionMeta: document.getElementById("graph-selection-meta"),
  graphSelectionTitle: document.getElementById("graph-selection-title"),
  graphOpenNodeBtn: document.getElementById("graph-open-node-btn"),
  stats: document.getElementById("stats"),
  vaultSearch: document.getElementById("vault-search"),
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
if (els.inlineReviewPanel) {
  els.inlineReviewPanel.appendChild(els.llmStatus);
  els.inlineReviewPanel.appendChild(els.reviewQuestions);
  els.inlineReviewPanel.appendChild(els.reviewReply);
  els.inlineReviewPanel.appendChild(els.reviewResponseBtn);
  els.inlineReviewPanel.appendChild(els.changePreview);
} else {
  els.llmStatus.after(els.changePreview);
}

els.themeToggle.checked = state.theme === "dark";
updateThemeToggleLabel();
hydrateApiControls();
hydrateApiGuardControls();
ensureApiSecretReady();
els.folderInput.addEventListener("change", handleSourceSelection);
els.fileInput.addEventListener("change", handleSourceSelection);
els.sourceList?.addEventListener("click", handleSourceActionClick);
els.bulkIngestBtn?.addEventListener("click", bulkIngestPendingSources);
els.docBody?.addEventListener("input", handleVaultDocumentEdit);
els.docBody?.addEventListener("scroll", syncDocHighlightScroll);
els.docSaveBtn?.addEventListener("click", saveCurrentVault);
els.reviewMode.value = state.reviewMode;
updateReviewModeHelp();
updateWorkflowState();
renderVaultTree();
renderDocHighlight();
restoreRememberedVault();
installTestHooks();

els.themeToggle.addEventListener("change", () => {
  state.theme = els.themeToggle.checked ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
  localStorage.setItem("margins-theme", state.theme);
  updateThemeToggleLabel();
});

globalThis.__marginsRunAnswer = setIngestReviewAnswer;

els.workflowBtn.addEventListener("click", runWorkflowStep);
els.vaultSearch?.addEventListener("input", () => {
  renderVaultTree();
  if (state.currentFileMap) renderWikiFiles(state.currentFileMap);
});
els.graphOpenNodeBtn?.addEventListener("click", openSelectedGraphNode);
els.saveApiKeyBtn.addEventListener("click", saveApiControls);
els.clearApiKeyBtn.addEventListener("click", clearApiControls);
els.apiGuardEnabled?.addEventListener("change", saveApiGuardControls);
els.apiMaxRequests?.addEventListener("change", saveApiGuardControls);
els.apiMaxOutputTokens?.addEventListener("change", saveApiGuardControls);
els.apiMaxSessionTokens?.addEventListener("change", saveApiGuardControls);
els.apiMaxSessionUsd?.addEventListener("change", saveApiGuardControls);
els.apiMinRequestDelay?.addEventListener("change", saveApiGuardControls);
els.apiMaxWindowRequests?.addEventListener("change", saveApiGuardControls);
els.resetApiUsageBtn?.addEventListener("click", resetApiUsage);
els.apiProvider.addEventListener("change", () => {
  els.apiModel.value = defaultModelForProvider(els.apiProvider.value);
  renderApiStatus();
  renderApiGuardStatus();
});
els.apiModel?.addEventListener("change", renderApiGuardStatus);

els.sourceDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  els.sourceDropZone.classList.add("dragging");
});

els.sourceDropZone.addEventListener("click", (event) => {
  if (event.target.closest("button, input, label, select, textarea, a")) return;
  els.fileInput.click();
});

els.sourceDropZone.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  els.fileInput.click();
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
  els.apiProvider.value = providerValue(settings.providerLabel) || "gemini";
  els.apiModel.value = settings.model || defaultModelForProvider(els.apiProvider.value);
  els.apiKey.value = "";
  renderApiStatus();
}

async function hydrateLocalEnvApiSecret() {
  if (state.apiSecret) return;
  if (new URLSearchParams(location.search).has("marginsTest")) return;
  try {
    const response = await fetch(".env", { cache: "no-store" });
    if (!response.ok) return;
    const env = parseDotEnv(await response.text());
    if (!env.GEMINI_API_KEY) return;
    state.apiSecret = env.GEMINI_API_KEY;
    if (els.apiProvider) els.apiProvider.value = "gemini";
    if (els.apiModel && !els.apiModel.value.trim()) {
      els.apiModel.value = defaultModelForProvider("gemini");
    }
    renderApiStatus(`${env.GEMINI_API_LABEL || "Gemini API free tier"} loaded from local .env.`);
  } catch {
    // Local .env is optional and ignored in production.
  }
}

function ensureApiSecretReady() {
  if (!apiSecretHydrationPromise) {
    apiSecretHydrationPromise = hydrateLocalEnvApiSecret();
  }
  return apiSecretHydrationPromise;
}

function parseDotEnv(text) {
  const env = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    env[key.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

function updateThemeToggleLabel() {
  if (!els.themeToggleLabel) return;
  els.themeToggleLabel.textContent = state.theme === "dark" ? "Dark mode" : "Light mode";
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
  const provider = providerLabel(els.apiProvider?.value || providerValue(settings.providerLabel) || "gemini");
  const model = els.apiModel?.value || settings.model || defaultModelForProvider(providerValue(settings.providerLabel));
  els.apiKeyStatus.textContent = message || (secret || settings.hasApiKey
    ? `${provider} · ${model} · ${maskSecret(secret) || settings.maskedApiKey}`
    : "Optional. Stored only in this browser for model-generated filing questions.");
}

function defaultApiGuardSettings() {
  return {
    enabled: true,
    maxRequests: 20,
    maxOutputTokens: 2048,
    maxSessionTokens: 250000,
    maxSessionUsd: 1,
    minRequestDelaySeconds: 2,
    maxRequestsPerWindow: 3,
    requestWindowSeconds: 10
  };
}

function loadApiGuardSettings() {
  try {
    return normalizeApiGuardSettings(JSON.parse(localStorage.getItem(API_GUARD_STORAGE_KEY) || "{}"));
  } catch {
    return defaultApiGuardSettings();
  }
}

function normalizeApiGuardSettings(settings = {}) {
  const defaults = defaultApiGuardSettings();
  return {
    enabled: settings.enabled !== false,
    maxRequests: positiveInteger(settings.maxRequests, defaults.maxRequests),
    maxOutputTokens: positiveInteger(settings.maxOutputTokens, defaults.maxOutputTokens),
    maxSessionTokens: positiveInteger(settings.maxSessionTokens, defaults.maxSessionTokens),
    maxSessionUsd: positiveNumber(settings.maxSessionUsd, defaults.maxSessionUsd),
    minRequestDelaySeconds: nonNegativeNumber(settings.minRequestDelaySeconds, defaults.minRequestDelaySeconds),
    maxRequestsPerWindow: positiveInteger(settings.maxRequestsPerWindow, defaults.maxRequestsPerWindow),
    requestWindowSeconds: positiveNumber(settings.requestWindowSeconds, defaults.requestWindowSeconds)
  };
}

function hydrateApiGuardControls() {
  const settings = state.apiGuardSettings;
  if (els.apiGuardEnabled) els.apiGuardEnabled.checked = settings.enabled;
  if (els.apiMaxRequests) els.apiMaxRequests.value = settings.maxRequests;
  if (els.apiMaxOutputTokens) els.apiMaxOutputTokens.value = settings.maxOutputTokens;
  if (els.apiMaxSessionTokens) els.apiMaxSessionTokens.value = settings.maxSessionTokens;
  if (els.apiMaxSessionUsd) els.apiMaxSessionUsd.value = settings.maxSessionUsd.toFixed(2);
  if (els.apiMinRequestDelay) els.apiMinRequestDelay.value = formatControlNumber(settings.minRequestDelaySeconds);
  if (els.apiMaxWindowRequests) els.apiMaxWindowRequests.value = settings.maxRequestsPerWindow;
  renderApiGuardStatus();
}

function saveApiGuardControls() {
  state.apiGuardSettings = normalizeApiGuardSettings({
    enabled: !!els.apiGuardEnabled?.checked,
    maxRequests: els.apiMaxRequests?.value,
    maxOutputTokens: els.apiMaxOutputTokens?.value,
    maxSessionTokens: els.apiMaxSessionTokens?.value,
    maxSessionUsd: els.apiMaxSessionUsd?.value,
    minRequestDelaySeconds: els.apiMinRequestDelay?.value,
    maxRequestsPerWindow: els.apiMaxWindowRequests?.value,
    requestWindowSeconds: state.apiGuardSettings.requestWindowSeconds
  });
  localStorage.setItem(API_GUARD_STORAGE_KEY, JSON.stringify(state.apiGuardSettings));
  hydrateApiGuardControls();
}

function resetApiUsage() {
  state.apiUsage = emptyApiUsage();
  apiThrottle.startedAt = [];
  apiThrottle.lastStartedAt = 0;
  renderApiGuardStatus("Usage reset for this browser session.");
}

function renderApiGuardStatus(message = "") {
  if (!els.apiGuardStatus) return;
  const usage = state.apiUsage;
  const settings = state.apiGuardSettings;
  const model = els.apiModel?.value || defaultModelForProvider("gemini");
  const rates = pricingForModel(model);
  const priceLabel = rates.source === "gemini-2.5-flash"
    ? "Flash pricing"
    : rates.source === "unknown"
      ? "conservative estimate"
      : `${rates.source} pricing`;
  const body = settings.enabled
    ? `${usage.requests}/${settings.maxRequests} calls · ${formatStatNumber(usage.totalTokens)}/${formatStatNumber(settings.maxSessionTokens)} tokens · ${formatUsd(usage.estimatedUsd)}/${formatUsd(settings.maxSessionUsd)} estimated · ${formatControlNumber(settings.minRequestDelaySeconds)}s gap · ${settings.maxRequestsPerWindow}/${formatControlNumber(settings.requestWindowSeconds)}s cap · ${priceLabel}.`
    : "Spend guard is off.";
  els.apiGuardStatus.textContent = message ? `${message} ${body}` : body;
}

function emptyApiUsage() {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedUsd: 0
  };
}

function positiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function positiveNumber(value, fallback) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeNumber(value, fallback) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function formatControlNumber(value) {
  return Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 1
  });
}

function providerValue(label) {
  const value = String(label || "").toLowerCase();
  if (value.includes("gemini") || value.includes("google")) return "gemini";
  if (value.includes("anthropic")) return "anthropic";
  if (value.includes("local")) return "local";
  if (value.includes("openai")) return "openai";
  return value;
}

function providerLabel(value) {
  return {
    gemini: "Gemini",
    openai: "OpenAI",
    anthropic: "Anthropic",
    local: "Local model"
  }[value] || "Gemini";
}

function defaultModelForProvider(provider) {
  return {
    gemini: "gemini-2.5-flash",
    openai: "gpt-5-mini",
    anthropic: "claude-3-5-haiku-latest",
    local: "local-filing-helper"
  }[provider] || "gemini-2.5-flash";
}

function defaultEndpointForProvider(provider) {
  return {
    gemini: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    openai: "https://api.openai.com/v1/chat/completions",
    anthropic: "https://api.anthropic.com/v1/messages",
    local: "http://localhost:11434/v1/chat/completions"
  }[provider] || "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent";
}

async function setSourceFiles(files) {
  const normalized = normalizeSelectedFiles(files);
  const incomingFiles = await Promise.all(normalized.map(async (file) => ({
    ...await readBrowserFile(file),
    sourceScope: "pending"
  })));
  state.files = mergeSourceFiles(state.files, incomingFiles);
  state.vault = null;
  if (!state.currentFileMap) {
    state.selectedPath = null;
  }
  state.llmFiles = new Map();
  state.llmSelectedPath = null;
  state.currentMaterialQuestions = [];
  state.ingestReviews = new Map();
  state.ingestAnswers = new Map();
  state.expandedSummaries = new Set();
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
  els.createVaultBtn.textContent = "Create vault";
  els.openVaultBtn.textContent = "Change vault";
  updateSaveButtonState();
  updateVaultStatus(name);
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
  state.editedRawFiles = new Map();
  state.loadedFileMap = new Map(fileMap);
  state.files = pendingRawSourcesFromVault(fileMap, rawFiles);
  renderSources();
  renderVaultTree(fileMap);
  updateActionState();

  if (hasVaultWikiContent(fileMap)) {
    state.vault = null;
    state.currentFileMap = fileMap;
    state.selectedPath = null;
    state.selectedKind = "";
    state.llmFiles = new Map();
    state.llmSelectedPath = null;
    state.currentMaterialQuestions = [];
    state.llmPromptCopied = false;
    state.hasSavedCurrent = true;
    state.hasUnsavedEdits = false;
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
  state.selectedKind = "";
  state.editedRawFiles = new Map();
  state.llmFiles = new Map();
  state.llmSelectedPath = null;
  state.currentMaterialQuestions = [];
  state.hasSavedCurrent = false;
  state.hasUnsavedEdits = false;
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

async function handleSourceActionClick(event) {
  const deleteButton = event.target.closest("[data-source-delete]");
  if (deleteButton) {
    event.stopPropagation();
    await removePendingSource(deleteButton.dataset.sourceDelete);
    return;
  }

  const summaryToggle = event.target.closest("[data-summary-toggle]");
  if (summaryToggle) {
    toggleSourceSummary(summaryToggle.dataset.summaryToggle);
    return;
  }

  const answerButton = event.target.closest("[data-run-answer]");
  if (answerButton) {
    setIngestReviewAnswer(answerButton.dataset.file, answerButton.dataset.question, answerButton.dataset.answer);
    return;
  }

  const button = event.target.closest("[data-source-action]");
  if (!button || state.processingInbox) return;
  await processPendingSource(button.dataset.sourceFile);
}

async function removePendingSource(fileName) {
  if (!fileName || state.processingInbox) return;
  const file = state.files.find((entry) => entry.name === fileName);
  if (!file) return;

  const rawSaved = rawSourceAlreadySaved(file);
  const message = rawSaved
    ? `Delete ${basename(fileName)} from raw_sources?`
    : `Remove ${basename(fileName)} from pending?`;
  if (!confirm(message)) return;

  try {
    if (rawSaved && state.vaultHandle) {
      await deleteRawSourceFromVault(state.vaultHandle, fileName);
    }
    removeSourceFromState(fileName);
    els.stats.textContent = rawSaved
      ? `Deleted ${basename(fileName)} from raw_sources.`
      : `Removed ${basename(fileName)} from pending.`;
  } catch (error) {
    els.stats.textContent = `Could not delete ${basename(fileName)}: ${error.message || "unknown error"}`;
  }
}

function removeSourceFromState(fileName) {
  state.files = state.files.filter((file) => file.name !== fileName);
  state.vaultFiles = state.vaultFiles.filter((file) => file.name !== fileName);
  state.editedRawFiles.delete(fileName);
  state.ingestReviews.delete(fileName);
  state.ingestErrors.delete(fileName);
  for (const key of [...state.ingestAnswers.keys()]) {
    if (key.startsWith(`${fileName}::`)) state.ingestAnswers.delete(key);
  }
  state.expandedSummaries.delete(fileName);
  renderSources();
  renderVaultTree(state.currentFileMap);
  renderWikiFiles(state.currentFileMap);
  updateActionState();
  updateWorkflowState();
}

function toggleSourceSummary(fileName) {
  if (!fileName) return;
  if (state.expandedSummaries.has(fileName)) state.expandedSummaries.delete(fileName);
  else state.expandedSummaries.add(fileName);
  renderSources();
}

function setIngestReviewAnswer(fileName, question, answer) {
  if (!fileName || !question || !answer) return;
  state.ingestAnswers.set(ingestAnswerKey(fileName, question), { fileName, question, answer });
  syncIngestAnswersToReviewReply();
  renderSources();
  updateWorkflowState();
}

function ingestAnswerKey(fileName, question) {
  return `${fileName}::${question}`;
}

function ingestAnswerFor(fileName, question) {
  return state.ingestAnswers.get(ingestAnswerKey(fileName, question))?.answer || "";
}

function syncIngestAnswersToReviewReply() {
  const lines = [...state.ingestAnswers.values()].map((entry) => `- ${entry.fileName} — ${entry.question}: ${entry.answer}`);
  els.reviewReply.value = lines.join("\n");
  updateReviewResponseState();
}

async function processPendingSource(fileName = "") {
  state.processingInbox = true;
  state.processingFileName = fileName || "";
  if (fileName) state.ingestErrors.delete(fileName);
  renderSources();
  updateSaveButtonState();
  try {
    const file = fileName ? state.files.find((entry) => entry.name === fileName) : null;
    if (file && isSourceReviewReady(file)) {
      await saveCurrentVault();
    } else if (!fileName && state.pendingSave && state.currentFileMap) {
      await saveCurrentVault();
    } else {
      await prepareInboxSave(fileName);
    }
  } finally {
    state.processingInbox = false;
    state.processingFileName = "";
    renderSources();
    updateSaveButtonState();
  }
}

async function bulkIngestPendingSources() {
  if (state.processingInbox || state.files.length === 0) return;
  state.processingInbox = true;
  state.processingFileName = "";
  renderSources();
  updateSaveButtonState();
  try {
    await prepareInboxSave("", { autoFile: true });
  } finally {
    state.processingInbox = false;
    state.processingFileName = "";
    renderSources();
    updateSaveButtonState();
  }
}

async function prepareInboxSave(fileName = "", options = {}) {
  if (!state.vaultHandle) {
    const reconnected = await reconnectRememberedVault();
    if (!reconnected && !await openVault()) return;
  }

  const targetFiles = filesForInboxProcess(fileName);
  if (targetFiles.length === 0) return;

  await savePendingRawSourcesImmediately(targetFiles);
  await prepareSourcesForProcessing(targetFiles);

  const existingFileMap = new Map(state.currentFileMap || []);
  state.vault = compileVault(targetFiles, { name: state.vaultName || "Karpathy Original" });
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
  await prepareReviewForCurrentFileMap(
    options.autoFile ? "Margins reviewed and filed the pending documents." : "Margins prepared this document. Answer any quick checks, then approve it.",
    targetFiles,
    { ...options, contextFileMap: existingFileMap }
  );
  if (options.autoFile) {
    await saveCurrentVault();
  }
}

function filesForInboxProcess(fileName = "") {
  if (!fileName) {
    const unprocessed = state.files.filter((file) => !isSourceReviewReady(file));
    return unprocessed.length ? unprocessed : state.files;
  }
  const file = state.files.find((entry) => entry.name === fileName);
  return file ? [file] : [];
}

async function savePendingRawSourcesImmediately(files = state.files) {
  if (!state.vaultHandle || files.length === 0) return 0;
  const toWrite = files
    .filter((file) => !rawSourceAlreadySaved(file))
    .map((file) => ({ ...file, sourceScope: "vault" }));
  const written = toWrite.length ? await writeRawSources(state.vaultHandle, toWrite) : 0;
  for (const file of files) {
    file.sourceScope = "vault";
    await refreshRawSourceBlobFromVault(file);
  }
  state.vaultFiles = mergeSourceFiles(state.vaultFiles, files.map((file) => ({ ...file, sourceScope: "vault", dirtyRaw: false })));
  renderVaultTree(state.currentFileMap);
  return written;
}

async function prepareSourcesForProcessing(files) {
  for (const file of files) {
    if (file.text) continue;

    if (file.type === "pdf") {
      await extractPdfTextForSource(file);
    } else if (file.type === "docx") {
      await extractDocxTextForSource(file);
    }
  }
}

async function saveCurrentVault() {
  if (!state.currentFileMap) return;
  const vault = state.vaultHandle || await createVault();
  if (!vault) return;

  els.saveVaultBtn.disabled = true;
  if (els.docSaveBtn) els.docSaveBtn.disabled = true;
  const originalText = els.saveVaultBtn.textContent;
  els.saveVaultBtn.textContent = "Saving...";
  if (els.docSaveBtn) els.docSaveBtn.textContent = "Saving...";

  try {
    const pendingRaw = mergeSourceFiles(state.files, [...state.editedRawFiles.values()]);
    const sourceCount = allSourceFiles().length;
    const rawToWrite = rawSourcesNeedingWrite(pendingRaw);
    const writtenRaw = rawToWrite.length ? await writeRawSources(vault, rawToWrite) : 0;
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
    state.vaultFiles = mergeSourceFiles(state.vaultFiles, pendingRaw.map((file) => ({ ...file, sourceScope: "vault", dirtyRaw: false })));
    state.files = pendingRawSourcesFromVault(state.currentFileMap, state.vaultFiles);
    state.editedRawFiles = new Map();
    state.ingestReviews = new Map();
    state.ingestAnswers = new Map();
    state.ingestErrors = new Map();
    state.expandedSummaries = new Set();
    state.loadedFileMap = new Map(state.currentFileMap);
    renderSources();
    renderVaultTree(state.currentFileMap);
    state.hasSavedCurrent = true;
    state.hasUnsavedEdits = false;
    state.pendingSave = false;
    state.llmPromptCopied = false;
    els.reviewReply.value = "";
    els.stats.textContent = pendingRaw.length === 0
      ? `Saved ${writtenFiles} wiki/operating files to ${state.vaultName}`
      : `Saved ${writtenFiles} wiki/operating file${writtenFiles === 1 ? "" : "s"} + ${writtenRaw} new raw source${writtenRaw === 1 ? "" : "s"} to ${state.vaultName}`;
    els.saveVaultBtn.textContent = "Saved";
    if (els.docSaveBtn) els.docSaveBtn.textContent = "Saved";
    renderWikiFiles(state.currentFileMap);
    activateTab("wiki");
    renderChangePreview();
    setTimeout(() => {
      els.saveVaultBtn.textContent = originalText;
      if (els.docSaveBtn) els.docSaveBtn.textContent = "Save";
      updateSaveButtonState();
    }, 1500);
  } catch (error) {
    if (error.name !== "AbortError") {
      els.stats.textContent = `Vault save failed: ${error.message || "unknown error"}`;
    }
    els.saveVaultBtn.textContent = originalText;
    if (els.docSaveBtn) els.docSaveBtn.textContent = "Save";
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

async function prepareReviewForCurrentFileMap(statusText, files = state.files, options = {}) {
  if (!state.currentFileMap) return;
  if (files.length > 0) {
    await prepareIngestReviews(statusText, files, options);
    return;
  }

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

  state.currentMaterialQuestions = limitMaterialQuestions(questions, state.reviewMode);
  renderMaterialQuestions(state.currentMaterialQuestions);
  els.llmStatus.textContent = state.currentMaterialQuestions.length
    ? `${statusText} One quick check needs your call.`
    : `${statusText} No questions needed.`;
  activateTab("inbox");
  updateWorkflowState();
}

async function prepareIngestReviews(statusText, files = state.files, options = {}) {
  await ensureApiSecretReady();
  const reviewMap = new Map(state.ingestReviews);
  const allQuestions = [];
  const reviewMode = options.autoFile ? "auto" : state.reviewMode;
  const apiContextFileMap = options.contextFileMap || state.currentFileMap;

  for (const file of files) {
    let review = localIngestReview(file, state.currentFileMap, reviewMode);
    if (requiresModelReview(file) && !canSendSourceToModel(file)) {
      state.ingestErrors.set(file.name, "Model review needs the original file or readable text. Re-add the file, then retry.");
      reviewMap.delete(file.name);
      continue;
    }
    if (requiresModelReview(file) && !state.apiSecret) {
      state.ingestErrors.set(file.name, "Model review needs the local Gemini key. Add a key, then retry.");
      reviewMap.delete(file.name);
      continue;
    }
    if (state.apiSecret && canSendSourceToModel(file)) {
      els.llmStatus.textContent = `Sending ${file.name} to the configured model with vault context...`;
      try {
        const apiReview = await generateApiIngestReview(file, apiContextFileMap, reviewMode);
        review = mergeIngestReview(review, apiReview, "api");
        state.apiQuestionSource = "api";
      } catch (error) {
        if (requiresModelReview(file)) {
          state.ingestErrors.set(file.name, ingestModelErrorMessage(error));
          reviewMap.delete(file.name);
          state.apiQuestionSource = "error";
          continue;
        }
        review.status = localFallbackStatusForModelError(error);
        state.apiQuestionSource = "heuristic";
      }
    }
    state.ingestErrors.delete(file.name);
    reviewMap.set(file.name, review);
    for (const question of review.questions || []) allQuestions.push(question);
    applyIngestReviewToFileMap(file, review);
  }

  state.ingestReviews = reviewMap;
  state.lastProcessedReviewNames = files.map((file) => file.name);
  state.currentMaterialQuestions = options.autoFile ? [] : limitMaterialQuestions(allQuestions, state.reviewMode);
  renderMaterialQuestions(state.currentMaterialQuestions);
  renderWikiFiles(state.currentFileMap);
  renderOperatingLayer(state.currentFileMap);
  drawGraph(graphFromFileMap(state.currentFileMap));
  renderSources();
  renderVaultTree(state.currentFileMap);
  els.llmStatus.textContent = state.currentMaterialQuestions.length
    ? `${statusText} ${state.currentMaterialQuestions.length} quick check${state.currentMaterialQuestions.length === 1 ? "" : "s"} need your call.`
    : `${statusText} No questions needed.`;
  activateTab("inbox");
  updateWorkflowState();
}

function localIngestReview(file, fileMap, mode) {
  return {
    source: "local",
    status: "Raw source saved. Local summary prepared while the model review runs.",
    summary: localSourceSummary(file),
    summaryBullets: summaryFallbackParts(localSourceSummary(file)).bullets,
    connections: [],
    questions: mode === "auto" ? [] : currentIngestQuestionsForFile(file, fileMap, mode)
  };
}

function ingestModelErrorMessage(error) {
  if (isSpendGuardError(error)) {
    return `${error.message} The raw source is saved. Raise the guard or reset usage, then retry.`;
  }
  if (isRateLimitError(error)) {
    return `Gemini quota or rate limit reached. The raw source is saved. ${retryAfterText(error)}Retry this file when the limit resets.`;
  }
  return `Model review did not finish: ${error.message || "unknown error"}`;
}

function localFallbackStatusForModelError(error) {
  if (isSpendGuardError(error)) {
    return `${error.message} Local review shown. Raise the guard or reset usage if you want model-generated questions.`;
  }
  if (isRateLimitError(error)) {
    return `Gemini quota or rate limit reached. Local review shown. ${retryAfterText(error)}Retry later if you want model-generated questions.`;
  }
  return `Model review failed, using local checks: ${error.message || "unknown error"}`;
}

function retryAfterText(error) {
  if (!error?.retryAfter) return "Wait a minute, then ";
  const seconds = Number(error.retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return `Wait about ${Math.ceil(seconds)} seconds, then `;
  return "";
}

function isRateLimitError(error) {
  return Number(error?.status) === 429 || /rate limit|rate-limited|quota|resource exhausted|free-tier limit|limit reached|HTTP 429/i.test(`${error?.message || error || ""}`);
}

function isSpendGuardError(error) {
  return error?.code === "MARGINS_SPEND_GUARD" || /spend guard stopped/i.test(`${error?.message || error || ""}`);
}

function canSendSourceToModel(file) {
  if (!file) return false;
  if (file.text) return true;
  const provider = els.apiProvider?.value || providerValue(state.apiSettings.providerLabel) || "gemini";
  return provider === "gemini" && canAttachSourceToGemini(file);
}

function requiresModelReview(file) {
  return needsTextExtraction(file) && !file.text;
}

function canAttachSourceToGemini(file) {
  return Boolean(file && (file.browserFile || file.rawSourceHandle || rawSourceAlreadySaved(file)) && sourceAttachmentMimeType(file));
}

function localSourceSummary(file) {
  const clean = cleanSummary(file.text || "");
  if (!clean) return "Margins saved the raw source, but there is not enough readable text to summarize yet.";
  const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
  return cleanSummary(sentences.slice(0, 4).join(" "));
}

function mergeIngestReview(localReview, apiReview, source) {
  const questions = source === "api"
    ? modelQuestionsOrFallback(apiReview)
    : apiReview.questions?.length ? apiReview.questions : localReview.questions;
  return {
    source,
    status: apiReview.status || "Model reviewed the source against the current vault.",
    provider: apiReview.provider || "",
    reviewedAt: apiReview.reviewedAt || "",
    summary: apiReview.summary || localReview.summary,
    summaryBullets: apiReview.summaryBullets?.length ? apiReview.summaryBullets : localReview.summaryBullets || [],
    connections: apiReview.connections?.length ? apiReview.connections : localReview.connections,
    questions
  };
}

function modelQuestionsOrFallback(apiReview) {
  if (apiReview.questions?.length) return apiReview.questions;
  if (apiReview.modelReturnedNoQuestions && apiReview.fallbackQuestions?.length) return apiReview.fallbackQuestions;
  return [];
}

function applyIngestReviewToFileMap(file, review) {
  if (!state.currentFileMap || !review) return;
  const entry = sourceNoteEntryForFile(file);
  if (!entry) return;

  let body = entry.body;
  if (review.summary) {
    body = replaceYamlSummary(body, review.summary);
    body = replaceSummarySection(body, review.summary);
  }
  if (review.connections?.length) {
    body = upsertConnectionsSection(body, review.connections);
  }
  state.currentFileMap.set(entry.path, body);
}

function sourceNoteEntryForFile(file) {
  return sourceNoteEntryForFileMap(file, state.currentFileMap);
}

function sourceNoteEntryForFileMap(file, fileMap) {
  if (!fileMap || !file?.name) return null;
  const rawPath = rawSourceOutputPath(file.name);
  for (const [path, body] of fileMap.entries()) {
    if (path.startsWith("wiki/sources/") && body.includes(rawPath)) return { path, body };
  }
  return null;
}

function isRawSourceIngested(file, fileMap = state.currentFileMap) {
  return Boolean(sourceNoteEntryForFileMap(file, fileMap));
}

function pendingRawSourcesFromVault(fileMap = state.currentFileMap, rawFiles = state.vaultFiles) {
  return rawFiles
    .filter((file) => !isRawSourceIngested(file, fileMap))
    .map((file) => ({ ...file, sourceScope: "vault" }));
}

function replaceYamlSummary(body, summary) {
  const line = `summary: ${JSON.stringify(cleanSummary(summary))}`;
  return body.replace(/^summary:\s*.*$/m, line);
}

function replaceSummarySection(body, summary) {
  const section = `## Summary\n\n${cleanSummary(summary)}`;
  if (/## Summary\s+[\s\S]*?(?=\n##\s|$)/.test(body)) {
    return body.replace(/## Summary\s+[\s\S]*?(?=\n##\s|$)/, section);
  }
  return `${body.trim()}\n\n${section}\n`;
}

function upsertConnectionsSection(body, connections) {
  const section = `## Connections\n\n${connections.map(formatConnectionLine).join("\n")}`;
  if (/## Connections\s+[\s\S]*?(?=\n##\s|$)/.test(body)) {
    return body.replace(/## Connections\s+[\s\S]*?(?=\n##\s|$)/, section);
  }
  return `${body.trim()}\n\n${section}\n`;
}

function formatConnectionLine(connection) {
  const title = connection.title || titleFromSlug(basename(connection.path || "connection").replace(/\.md$/, ""));
  const link = connection.path && connection.path.startsWith("wiki/")
    ? `[[${basename(connection.path).replace(/\.md$/, "")}|${title}]]`
    : title;
  const label = connection.type === "new" ? "new page" : "existing";
  return `- ${link} (${label}) — ${connection.reason || "Relevant to this source."}`;
}

async function generateApiReviewQuestions(fileMap, files) {
  const provider = els.apiProvider?.value || providerValue(state.apiSettings.providerLabel) || "gemini";
  const model = els.apiModel?.value.trim() || defaultModelForProvider(provider);
  const prompt = buildApiQuestionPrompt(fileMap, files);

  if (provider === "gemini") {
    return generateGeminiReviewQuestions(model, prompt);
  }

  if (provider !== "openai" && provider !== "local") {
    throw new Error("Direct browser calls are wired for Gemini and OpenAI-compatible endpoints right now.");
  }

  const endpoint = defaultEndpointForProvider(provider);
  const budget = reserveApiBudget({
    provider,
    model,
    prompt,
    extraParts: [],
    outputTokenLimit: apiOutputTokenLimit()
  });
  await waitForApiThrottle(provider);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${state.apiSecret}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: budget.outputTokenLimit,
      messages: [
        {
          role: "system",
          content: "You generate concise filing review questions for a local-first personal wiki. Return JSON only."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    throw await apiErrorFromResponse(response, "model review");
  }
  const json = await response.json();
  recordApiUsage({
    provider,
    model,
    inputTokens: json.usage?.prompt_tokens || budget.inputTokens,
    outputTokens: json.usage?.completion_tokens || budget.outputTokenLimit,
    estimated: !json.usage
  });
  const content = json.choices?.[0]?.message?.content || "";
  return parseApiQuestions(content).slice(0, 3);
}

async function generateApiIngestReview(file, fileMap, mode) {
  const provider = els.apiProvider?.value || providerValue(state.apiSettings.providerLabel) || "gemini";
  const model = els.apiModel?.value.trim() || defaultModelForProvider(provider);
  const prompt = buildApiIngestReviewPrompt(file, fileMap, mode);
  let content = "";

  if (provider === "gemini") {
    content = await generateGeminiJsonContent(model, prompt, await geminiSourceParts(file));
  } else if (provider === "openai" || provider === "local") {
    content = await generateOpenAiCompatibleJsonContent(provider, model, prompt);
  } else {
    throw new Error("Direct browser calls are wired for Gemini and OpenAI-compatible endpoints right now.");
  }

  return parseApiIngestReview(content, file, mode, provider);
}

async function generateOpenAiCompatibleJsonContent(provider, model, prompt) {
  const endpoint = defaultEndpointForProvider(provider);
  const budget = reserveApiBudget({
    provider,
    model,
    prompt,
    extraParts: [],
    outputTokenLimit: apiOutputTokenLimit()
  });
  await waitForApiThrottle(provider);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${state.apiSecret}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: budget.outputTokenLimit,
      messages: [
        {
          role: "system",
          content: "You review one uploaded source for a local-first personal wiki. Return JSON only."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    throw await apiErrorFromResponse(response, "model review");
  }
  const json = await response.json();
  recordApiUsage({
    provider,
    model,
    inputTokens: json.usage?.prompt_tokens || budget.inputTokens,
    outputTokens: json.usage?.completion_tokens || budget.outputTokenLimit,
    estimated: !json.usage
  });
  return json.choices?.[0]?.message?.content || "";
}

async function generateGeminiReviewQuestions(model, prompt) {
  const content = await generateGeminiJsonContent(model, `You generate concise filing review questions for a local-first personal wiki. Return JSON only.\n\n${prompt}`);
  return parseApiQuestions(content).slice(0, 3);
}

async function generateGeminiJsonContent(model, prompt, extraParts = []) {
  const endpoint = defaultEndpointForProvider("gemini").replace("{model}", encodeURIComponent(normalizeGeminiModel(model)));
  const budget = reserveApiBudget({
    provider: "gemini",
    model,
    prompt,
    extraParts,
    outputTokenLimit: apiOutputTokenLimit()
  });
  await waitForApiThrottle("gemini");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": state.apiSecret
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: prompt
            },
            ...extraParts
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        maxOutputTokens: budget.outputTokenLimit
      }
    })
  });

  if (!response.ok) {
    throw await apiErrorFromResponse(response, "Gemini");
  }
  const json = await response.json();
  recordApiUsage({
    provider: "gemini",
    model,
    inputTokens: json.usageMetadata?.promptTokenCount || budget.inputTokens,
    outputTokens: geminiOutputTokenCount(json.usageMetadata) || budget.outputTokenLimit,
    estimated: !json.usageMetadata
  });
  return json.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "";
}

async function apiErrorFromResponse(response, providerLabel = "API") {
  const status = response.status;
  const retryAfter = response.headers?.get?.("retry-after") || "";
  let detail = "";
  try {
    const json = await response.clone().json();
    detail = cleanSummary(json?.error?.message || json?.message || "");
  } catch {
    try {
      detail = cleanSummary(await response.clone().text());
    } catch {
      detail = "";
    }
  }

  const message = status === 429
    ? `${providerLabel} rate limit reached${detail ? `: ${detail}` : "."}`
    : `${providerLabel} request failed: HTTP ${status}${detail ? `: ${detail}` : ""}`;
  const error = new Error(message);
  error.status = status;
  error.retryAfter = retryAfter;
  return error;
}

function apiOutputTokenLimit() {
  return state.apiGuardSettings.enabled
    ? state.apiGuardSettings.maxOutputTokens
    : defaultApiGuardSettings().maxOutputTokens;
}

function reserveApiBudget({ provider, model, prompt, extraParts = [], outputTokenLimit = apiOutputTokenLimit() }) {
  const inputTokens = estimateRequestInputTokens(prompt, extraParts);
  const outputTokens = positiveInteger(outputTokenLimit, defaultApiGuardSettings().maxOutputTokens);
  const estimatedUsd = estimateModelCostUsd(model, inputTokens, outputTokens);
  const guard = state.apiGuardSettings;

  if (guard.enabled) {
    const projectedRequests = state.apiUsage.requests + 1;
    const projectedTokens = state.apiUsage.totalTokens + inputTokens + outputTokens;
    const projectedUsd = state.apiUsage.estimatedUsd + estimatedUsd;
    const reasons = [];
    if (projectedRequests > guard.maxRequests) {
      reasons.push(`${projectedRequests}/${guard.maxRequests} model calls`);
    }
    if (projectedTokens > guard.maxSessionTokens) {
      reasons.push(`${formatStatNumber(projectedTokens)}/${formatStatNumber(guard.maxSessionTokens)} tokens`);
    }
    if (projectedUsd > guard.maxSessionUsd) {
      reasons.push(`${formatUsd(projectedUsd)}/${formatUsd(guard.maxSessionUsd)} estimated`);
    }
    if (reasons.length) {
      throw spendGuardError(`Spend guard stopped this ${providerLabel(provider)} call before it ran: ${reasons.join(", ")}.`);
    }
  }

  state.apiUsage.requests += 1;
  renderApiGuardStatus();
  return { inputTokens, outputTokenLimit: outputTokens, estimatedUsd };
}

function recordApiUsage({ provider, model, inputTokens = 0, outputTokens = 0, estimated = false }) {
  const safeInput = Math.max(0, Math.ceil(Number(inputTokens) || 0));
  const safeOutput = Math.max(0, Math.ceil(Number(outputTokens) || 0));
  state.apiUsage.inputTokens += safeInput;
  state.apiUsage.outputTokens += safeOutput;
  state.apiUsage.totalTokens += safeInput + safeOutput;
  state.apiUsage.estimatedUsd += estimateModelCostUsd(model, safeInput, safeOutput);
  const suffix = estimated ? " Usage estimated because the model did not return token metadata." : "";
  renderApiGuardStatus(`${providerLabel(provider)} call recorded.${suffix}`);
}

function waitForApiThrottle(provider) {
  if (!state.apiGuardSettings.enabled) return Promise.resolve();
  const run = apiThrottle.queue.then(() => runApiThrottleWait(provider));
  apiThrottle.queue = run.catch(() => {});
  return run;
}

async function runApiThrottleWait(provider) {
  let waitMs = apiThrottleWaitMs();
  while (waitMs > 0) {
    renderApiGuardStatus(`Waiting ${formatWaitSeconds(waitMs)}s before the next ${providerLabel(provider)} call.`);
    await sleep(waitMs);
    waitMs = apiThrottleWaitMs();
  }

  const now = Date.now();
  apiThrottle.lastStartedAt = now;
  apiThrottle.startedAt = recentApiCallStarts(now);
  apiThrottle.startedAt.push(now);
  renderApiGuardStatus(`${providerLabel(provider)} request started.`);
}

function apiThrottleWaitMs(now = Date.now()) {
  const settings = state.apiGuardSettings;
  const minDelayMs = Math.max(0, Number(settings.minRequestDelaySeconds) || 0) * 1000;
  const windowMs = Math.max(1, Number(settings.requestWindowSeconds) || 10) * 1000;
  const maxInWindow = Math.max(1, Number(settings.maxRequestsPerWindow) || 1);
  const recentStarts = recentApiCallStarts(now);
  const delayWait = apiThrottle.lastStartedAt ? Math.max(0, apiThrottle.lastStartedAt + minDelayMs - now) : 0;
  const windowWait = recentStarts.length >= maxInWindow
    ? Math.max(0, recentStarts[0] + windowMs - now)
    : 0;
  return Math.ceil(Math.max(delayWait, windowWait));
}

function recentApiCallStarts(now = Date.now()) {
  const windowMs = Math.max(1, Number(state.apiGuardSettings.requestWindowSeconds) || 10) * 1000;
  apiThrottle.startedAt = apiThrottle.startedAt.filter((startedAt) => now - startedAt < windowMs);
  return apiThrottle.startedAt;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function formatWaitSeconds(ms) {
  return (Math.ceil(ms / 100) / 10).toLocaleString("en-US", {
    maximumFractionDigits: 1
  });
}

function spendGuardError(message) {
  const error = new Error(message);
  error.code = "MARGINS_SPEND_GUARD";
  return error;
}

function geminiOutputTokenCount(usage = {}) {
  return Number(usage.candidatesTokenCount || 0) + Number(usage.thoughtsTokenCount || 0);
}

function estimateRequestInputTokens(prompt, extraParts = []) {
  return Math.ceil(estimateTextTokens(prompt) + extraParts.reduce((sum, part) => (
    sum + estimatePartTokens(part)
  ), 0));
}

function estimateTextTokens(text) {
  const value = String(text || "");
  if (!value) return 0;
  const byChars = value.length / 4;
  const byWords = wordCount(value) * 1.35;
  return Math.max(1, Math.ceil(Math.max(byChars, byWords)));
}

function estimatePartTokens(part) {
  if (part?.text) return estimateTextTokens(part.text);
  const data = part?.inline_data?.data || part?.inlineData?.data || "";
  const mime = part?.inline_data?.mime_type || part?.inlineData?.mimeType || "";
  if (!data) return 0;
  const bytes = Math.ceil(String(data).length * 0.75);
  if (/pdf/i.test(mime)) {
    return Math.max(258, Math.ceil(bytes / 4096) * 258);
  }
  if (/image/i.test(mime)) return 560;
  if (/audio/i.test(mime)) return Math.ceil(bytes / 120);
  return Math.ceil(bytes / 4);
}

function estimateModelCostUsd(model, inputTokens, outputTokens) {
  const rates = pricingForModel(model);
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}

function pricingForModel(model) {
  const normalized = normalizeGeminiModel(model).toLowerCase();
  if (normalized.includes("flash-lite")) return { input: 0.10, output: 0.40, source: "gemini-2.5-flash-lite" };
  if (normalized.includes("flash")) return { input: 0.30, output: 2.50, source: "gemini-2.5-flash" };
  if (normalized.includes("pro")) return { input: 1.25, output: 10.00, source: "gemini-2.5-pro <=200k" };
  return { input: 1.25, output: 10.00, source: "unknown" };
}

async function geminiSourceParts(file) {
  if (!file || file.text || !canAttachSourceToGemini(file)) return [];
  const attachment = await sourceAttachmentForModel(file);
  if (!attachment) return [];
  return [{
    inline_data: {
      mime_type: attachment.mimeType,
      data: await blobToBase64WithRefresh(file, attachment.blob)
    }
  }];
}

async function sourceAttachmentForModel(file) {
  const blob = await refreshRawSourceBlobFromVault(file) || file.browserFile;
  if (!blob) return null;
  const mimeType = sourceAttachmentMimeType(file, blob);
  return mimeType ? { blob, mimeType } : null;
}

async function refreshRawSourceBlobFromVault(file) {
  if (!file?.name) return null;
  let handle = file.rawSourceHandle || null;
  if (!handle && state.vaultHandle) {
    try {
      handle = await fileHandleForPath(state.vaultHandle, rawSourceOutputPath(file.name), false);
      file.rawSourceHandle = handle;
    } catch {
      handle = null;
    }
  }
  if (!handle?.getFile) return null;
  const freshFile = await handle.getFile();
  file.browserFile = freshFile;
  file.size = freshFile.size;
  file.lastModified = freshFile.lastModified;
  return freshFile;
}

async function blobToBase64WithRefresh(file, blob) {
  try {
    return await blobToBase64(blob);
  } catch (error) {
    if (!isStaleBrowserFileError(error)) throw error;
    const freshBlob = await refreshRawSourceBlobFromVault(file);
    if (!freshBlob || freshBlob === blob) {
      throw new Error("The saved source could not be read. Reopen the vault or re-add the file, then retry.");
    }
    return blobToBase64(freshBlob);
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Could not read file."));
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",").pop() : result);
    };
    reader.readAsDataURL(blob);
  });
}

function normalizeGeminiModel(model) {
  return String(model || defaultModelForProvider("gemini")).replace(/^models\//, "");
}

function sourceAttachmentMimeType(file, blob = null) {
  return (blob?.type || file?.browserFile?.type || mimeTypeFromPath(file?.name || "")).trim();
}

function mimeTypeFromPath(path) {
  const ext = basename(path).split(".").pop()?.toLowerCase() || "";
  return {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
    md: "text/markdown",
    markdown: "text/markdown",
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    json: "application/json",
    jsonl: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif"
  }[ext] || "";
}

function isStaleBrowserFileError(error) {
  return /requested file could not be read|permission problems|notreadable|could not be read/i.test(
    `${error?.name || ""} ${error?.message || error || ""}`
  );
}

function buildApiIngestReviewPrompt(file, fileMap, mode) {
  const budget = questionBudgetForMode(mode);
  const questionInstruction = mode === "auto"
    ? "Return no questions in auto mode."
    : `Return 1-${budget} high-signal questions for calls, meetings, interviews, transcripts, emails, or decision notes unless the source is purely archival and no answer would change meaning, follow-up, sensitivity, or priority.`;
  return `Review this uploaded source for Margins, a local-first raw-source-to-wiki compiler.

Pipeline:
1. The raw file is already saved in raw_sources.
2. You receive the source text, current wiki context, and guardrails.
3. Return a concise summary, useful vault connections, and ${budget} or fewer user questions.
4. Margins will show this on the pending card before writing the wiki.

Guardrails:
- Preserve raw evidence. Never imply the raw file was changed.
- Do not ask where to file the document. Margins handles filing.
- Do not ask generic approval questions.
- ${questionInstruction}
- Ask only if the answer changes meaning, identity, priority, sensitivity, or a follow-up action.
- Avoid acronym/initial questions unless the acronym is central.
- Prefer yes/no or short options, and always include a default recommendation.
- Connections should point to existing wiki paths when useful. Suggest a new page only if it would be reusable.
- Do not return a transcript dump. The summary must be skimmable: one short overview and 3-5 short bullets.
- Review mode is ${reviewModeLabel(mode)}. Question budget: ${budget}.

Return JSON only:
{
  "summary": {
    "overview": "One plain-English sentence about what this source is.",
    "bullets": [
      "Short point about what matters.",
      "Short point about useful context or decisions.",
      "Short point about follow-up or risk if present."
    ]
  },
  "connections": [
    {"path":"wiki/...", "title":"...", "type":"existing|new", "reason":"why this connection matters"}
  ],
  "questions": [
    {"kind":"Quick check", "question":"...", "reason":"...", "recommendation":"My take: ...", "options":["Yes","No","Use default"]}
  ]
}

Uploaded source:
Name: ${file.name}
Type: ${file.type}
Words: ${wordCount(file.text || "")}
Text:
${sourceTextForModelPrompt(file)}

Current wiki context:
${wikiContextForIngestPrompt(fileMap, file)}

Operating guardrails:
${operatingContextForPrompt(fileMap)}`;
}

function sourceTextForModelPrompt(file) {
  if (file.text) return excerptForQuestion(file.text, 12000);
  if (canAttachSourceToGemini(file)) {
    return `[Original ${sourceTypeLabel(file)} file attached in this request. Read the attached file directly and summarize only what it supports.]`;
  }
  return excerptForQuestion(file.extractionError || "", 12000);
}

function questionBudgetForMode(mode) {
  return {
    auto: 0,
    suggested: 2,
    strict: 3
  }[mode] ?? 2;
}

function wikiContextForIngestPrompt(fileMap, file = null) {
  if (!fileMap?.size) return "- No existing wiki context loaded.";
  const records = wikiContextRecords(fileMap);
  if (!records.length) return "- No existing wiki context loaded.";

  const queryText = [
    file?.name || "",
    file?.text || "",
    file?.extractionError || ""
  ].join("\n");
  const queryTerms = keywordSet(queryText);
  const backlinkCounts = backlinkCountByPath(records);
  const scored = records
    .map((record) => ({
      ...record,
      backlinkCount: backlinkCounts.get(record.path) || 0,
      score: scoreWikiContextRecord(record, queryText, queryTerms)
    }))
    .sort((left, right) => right.score - left.score || right.backlinkCount - left.backlinkCount || left.path.localeCompare(right.path));
  const selected = selectWikiContextRecords(scored);

  return [
    `Use these existing wiki nodes when filing this source. Prefer exact existing paths over creating new pages. Context is ranked from ${records.length} loaded wiki markdown files, including real vault folders like career/, personal/, projects/, daily/, ideas/, and coding/.`,
    ...selected.map(formatWikiContextRecord)
  ].join("\n");
}

function wikiContextRecords(fileMap) {
  return [...fileMap.entries()]
    .filter(([path]) => isContextWikiPagePath(path))
    .map(([path, body]) => wikiContextRecord(path, body));
}

function isContextWikiPagePath(path) {
  return path.startsWith("wiki/") &&
    path.endsWith(".md") &&
    !path.startsWith("wiki/.margins/") &&
    !path.startsWith("wiki/_templates/");
}

function wikiContextRecord(path, body) {
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

function frontmatterFields(body) {
  const match = String(body || "").match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return {};
  const fields = {};
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;
    fields[field[1]] = field[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return fields;
}

function frontmatterList(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw
      .slice(1, -1)
      .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

function bodyWithoutFrontmatter(body) {
  return String(body || "").replace(/^---\n[\s\S]*?\n---\n/, "");
}

function contextSnippet(body) {
  const clean = bodyWithoutFrontmatter(body)
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("# ") && !/^Raw file:/i.test(trimmed);
    })
    .slice(0, 18)
    .join(" ");
  return excerptForQuestion(clean, 360);
}

function cleanWikiLinkLabel(link) {
  return String(link || "")
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]
    .replace(/\.md$/, "")
    .trim();
}

function keywordSet(text) {
  return new Set(String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2 && !STOP_WORDS_FOR_CONTEXT.has(term)));
}

const STOP_WORDS_FOR_CONTEXT = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "about", "what",
  "when", "where", "which", "while", "have", "has", "had", "not", "you", "your",
  "was", "were", "are", "been", "being", "can", "could", "would", "should", "all",
  "any", "one", "two", "new", "raw", "source", "sources", "summary", "transcript",
  "file", "files", "document", "documents", "call", "zoom", "meeting"
]);

function backlinkCountByPath(records) {
  const bySlug = new Map();
  const counts = new Map(records.map((record) => [record.path, 0]));
  for (const record of records) {
    bySlug.set(record.path, record.path);
    bySlug.set(record.path.replace(/^wiki\//, "").replace(/\.md$/, ""), record.path);
    bySlug.set(basename(record.path).replace(/\.md$/, ""), record.path);
    bySlug.set(slugifyLoose(record.title), record.path);
  }
  for (const record of records) {
    for (const link of record.keyLinks) {
      const target = bySlug.get(cleanWikiLinkLabel(link)) || bySlug.get(slugifyLoose(link));
      if (target && target !== record.path) counts.set(target, (counts.get(target) || 0) + 1);
    }
  }
  return counts;
}

function scoreWikiContextRecord(record, queryText, queryTerms) {
  const haystack = `${record.path} ${record.title} ${record.summary} ${record.tags.join(" ")} ${record.keyLinks.join(" ")}`.toLowerCase();
  const queryLower = String(queryText || "").toLowerCase();
  let score = 0;
  const titleLower = record.title.toLowerCase();
  if (titleLower.length > 3 && queryLower.includes(titleLower)) score += 80;
  const slug = basename(record.path).replace(/\.md$/, "").replace(/[-_]+/g, " ").toLowerCase();
  if (slug.length > 3 && queryLower.includes(slug)) score += 55;
  for (const term of queryTerms) {
    if (haystack.includes(term)) score += 4;
  }
  for (const link of record.keyLinks) {
    const linkText = cleanWikiLinkLabel(link).replace(/[-_]+/g, " ").toLowerCase();
    if (linkText.length > 3 && queryLower.includes(linkText)) score += 18;
  }
  if (/pinned|high|peak/i.test(`${record.priority} ${record.tags.join(" ")}`)) score += 10;
  if (/active|fresh|recent/i.test(`${record.status} ${record.tags.join(" ")}`)) score += 8;
  if (record.path === "wiki/index.md") score += 5;
  if (record.path.startsWith("wiki/sources/")) score -= 2;
  return score;
}

function selectWikiContextRecords(scored) {
  const selected = new Map();
  for (const record of scored.filter((entry) => entry.score > 0).slice(0, 36)) {
    selected.set(record.path, record);
  }
  for (const record of scored.filter(isPinnedContextRecord).slice(0, 12)) {
    selected.set(record.path, record);
  }
  if (selected.size < 16) {
    for (const record of scored.slice(0, 24)) selected.set(record.path, record);
  }
  return [...selected.values()]
    .sort((left, right) => right.score - left.score || right.backlinkCount - left.backlinkCount || left.path.localeCompare(right.path))
    .slice(0, 48);
}

function isPinnedContextRecord(record) {
  return record.path === "wiki/index.md" || /pinned|peak|active|fresh/i.test(`${record.priority} ${record.status} ${record.tags.join(" ")}`);
}

function formatWikiContextRecord(record) {
  const bits = [
    `title: ${record.title}`,
    `type: ${record.type || "note"}`,
    `bucket: ${record.bucket}`,
    record.status ? `status: ${record.status}` : "",
    record.priority ? `priority: ${record.priority}` : "",
    record.updated ? `updated: ${record.updated}` : "",
    record.backlinkCount ? `backlinks: ${record.backlinkCount}` : "",
    record.tags.length ? `tags: ${record.tags.slice(0, 8).join(", ")}` : "",
    record.keyLinks.length ? `links: ${record.keyLinks.slice(0, 8).join(", ")}` : ""
  ].filter(Boolean).join(" · ");
  const summary = record.summary ? ` — ${record.summary}` : "";
  const snippet = record.snippet && record.snippet !== record.summary ? `\n  signal: ${record.snippet}` : "";
  return `- ${record.path} (${bits})${summary}${snippet}`;
}

function operatingContextForPrompt(fileMap) {
  if (!fileMap?.size) return "- Local-first. Proposal-first. No silent write-back.";
  const parts = [
    fileMap.get("CLAUDE.md"),
    fileMap.get("operator-manual.md"),
    fileMap.get("query-cookbook.md"),
    fileMap.get("wiki/ingest-tracker.md"),
    fileMap.get("wiki/log.md"),
    fileMap.get("wiki/wiki-stats.md")
  ].filter(Boolean).map((body) => excerptForQuestion(body, 900));
  return parts.length ? parts.join("\n\n") : "- Local-first. Proposal-first. No silent write-back.";
}

function parseApiIngestReview(content, file, mode, provider = "gemini") {
  const parsed = parseJsonObject(content);
  if (!parsed) {
    throw new Error(`${providerLabel(provider)} returned review text that Margins could not parse as JSON.`);
  }
  const connections = Array.isArray(parsed.connections) ? parsed.connections : [];
  const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
  const summaryParts = apiSummaryParts(parsed.summary, parsed.summaryBullets || parsed.bullets);
  if (!summaryParts.overview && summaryParts.bullets.length === 0) {
    throw new Error(`${providerLabel(provider)} did not return a usable summary.`);
  }
  const parsedQuestions = questions
    .map((question) => reviewQuestion(
      /careful|sensitive|risk|warning/i.test(question.kind || "") ? "warn" : "suggest",
      question.kind || "Quick check",
      `raw_sources/${file.name}`,
      question.question || "",
      question.reason || "The model flagged this as useful before filing.",
      question.recommendation || "My take: use the default unless it looks wrong.",
      Array.isArray(question.options) && question.options.length ? question.options.slice(0, 4) : ["Yes", "No", "Use default"]
    ))
    .filter((question) => question.question)
    .slice(0, questionBudgetForMode(mode));
  const modelReturnedNoQuestions = mode !== "auto" && parsedQuestions.length === 0;
  return {
    source: "api",
    provider,
    reviewedAt: new Date().toISOString(),
    status: modelReturnedNoQuestions
      ? `${providerLabel(provider)} reviewed the source but did not return follow-up questions.`
      : `${providerLabel(provider)} reviewed the source against the current vault.`,
    summary: summaryParts.overview,
    summaryBullets: summaryParts.bullets,
    connections: connections
      .map((connection) => ({
        path: String(connection.path || "").trim(),
        title: String(connection.title || "").trim(),
        type: /new/i.test(connection.type || "") ? "new" : "existing",
        reason: cleanSummary(connection.reason || "")
      }))
      .filter((connection) => connection.title || connection.path || connection.reason)
      .slice(0, 5),
    questions: parsedQuestions,
    modelReturnedNoQuestions,
    fallbackQuestions: modelReturnedNoQuestions ? fallbackQuestionsForModelReview(file, summaryParts) : []
  };
}

function apiSummaryParts(summary, extraBullets = []) {
  if (summary && typeof summary === "object" && !Array.isArray(summary)) {
    const overview = cleanSummary(summary.overview || summary.title || summary.text || "");
    const bullets = apiSummaryBullets(summary, extraBullets);
    const fallback = summaryFallbackParts(cleanSummary([overview, ...bullets].filter(Boolean).join(" ")));
    return {
      overview: overview || fallback.overview,
      bullets: bullets.length ? bullets : fallback.bullets
    };
  }
  return summaryFallbackParts(summary);
}

function apiSummaryBullets(summary, extraBullets = []) {
  const values = [];
  if (summary && typeof summary === "object" && !Array.isArray(summary)) {
    values.push(...arrayFromUnknown(summary.bullets));
    values.push(...arrayFromUnknown(summary.points));
    values.push(...arrayFromUnknown(summary.keyPoints));
  }
  values.push(...arrayFromUnknown(extraBullets));
  return values
    .map((item) => cleanSummary(item))
    .filter(Boolean)
    .slice(0, 5);
}

function arrayFromUnknown(value) {
  return Array.isArray(value) ? value : [];
}

function summaryFallbackParts(summary) {
  const parts = splitSummaryForCard(summary);
  return {
    overview: parts[0] ? clampSentence(parts[0], 220) : "",
    bullets: parts.slice(1, 6).map((part) => clampSentence(part, 220)).filter(Boolean)
  };
}

function splitSummaryForCard(summary) {
  const clean = cleanSummary(summary);
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

function chunkLongSummary(summary, maxLength) {
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

function fallbackQuestionsForModelReview(file, summaryParts) {
  if (state.reviewMode === "auto") return [];
  const signal = `${file?.name || ""} ${file?.text || ""} ${summaryParts.overview || ""} ${summaryParts.bullets.join(" ")}`;
  if (!looksLikeFollowUpSource(signal)) return [];
  return [reviewQuestion(
    "suggest",
    "Follow-up",
    `raw_sources/${file.name}`,
    "Should Margins track this as an active follow-up?",
    "Gemini returned no follow-up questions, but this source looks like a call, meeting, opportunity, or decision note.",
    "My take: track it if you expect another action or conversation.",
    ["Track it", "Just file it", "Skip"]
  )];
}

function looksLikeFollowUpSource(text) {
  return /call|meeting|zoom|follow[- ]?up|next steps?|opportunit|decision|role|offer|interview|email|conversation|discussed|should|needs to decide/i.test(text || "");
}

function buildApiQuestionPrompt(fileMap, files) {
  const sourceNames = files.map((file) => `- ${file.name}: ${excerptForQuestion(file.text || file.extractionError || "", 600)}`).join("\n") || "- No new source text available.";
  const changedPaths = [...fileMap.keys()]
    .filter((path) => isWikiPagePath(path))
    .slice(0, 28)
    .join("\n");
  return `Create 0-3 quick questions before Margins saves this local vault.

Rules:
- Do not ask where to file this or whether to create pages. Margins can decide that.
- Ask only deeper questions about meaning, identity, priority, action, decision, or user intent.
- Ask nothing if the source is clear enough.
- Prefer yes/no or short option buttons that a user can answer in one tap.
- Do not ask about random acronyms, initials, or short labels unless they are central to understanding the source.
- Include a default recommendation.
- Do not ask generic approval or routing questions.

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
  const sourceIngestMode = state.files.length > 0 && !parsedMode;
  const unsavedMode = !parsedMode && state.currentFileMap && (state.pendingSave || state.hasUnsavedEdits);
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

  if (sourceIngestMode) {
    els.changeSummary.innerHTML = "";
    els.changePreview.innerHTML = "";
    updateInlineReviewVisibility();
    return;
  }

  if (!parsedMode && !unsavedMode) {
    els.changeSummary.innerHTML = "";
    els.changePreview.innerHTML = "";
    updateInlineReviewVisibility();
    return;
  }

  const title = parsedMode ? "Returned files" : "Ingestion preview";
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
    ...summaryChanges.filter(isUserFacingChange).map((change) => ({ ...change, kind: changeKindLabel(change.path) })),
    ...rawChanges.map((change) => ({ ...change, kind: "raw source" }))
  ];

  if (detailChanges.length === 0) {
    els.changePreview.innerHTML = `
      <div class="mini-card">
        <strong>${escapeHtml(title)}</strong><br>
        <span>No file changes detected before save.</span>
      </div>
    `;
    updateInlineReviewVisibility();
    return;
  }

  els.changePreview.innerHTML = `
    <div class="mini-card">
      <strong>${escapeHtml(title)}</strong><br>
      <span>${escapeHtml(summaryText)}. Margins will also update operating files quietly.</span>
    </div>
    ${detailChanges.slice(0, 4).map((change) => `
      <div class="mini-card">
        <strong>${escapeHtml(changeStatusLabel(change.status))}: ${escapeHtml(change.path)}</strong><br>
        <span>${escapeHtml(change.kind)}${change.words ? ` · ${change.words} words` : ""}</span>
      </div>
    `).join("")}
    ${detailChanges.length > 4 ? `<div class="mini-card"><span>${detailChanges.length - 4} more wiki/source changes hidden.</span></div>` : ""}
  `;
  updateInlineReviewVisibility();
}

function isUserFacingChange(change) {
  return change.path.startsWith("raw_sources/") ||
    change.path.startsWith("wiki/sources/") ||
    change.path.startsWith("wiki/concepts/") ||
    change.path.startsWith("wiki/entities/") ||
    change.path.startsWith("wiki/synthesis/");
}

function changeKindLabel(path) {
  if (path.startsWith("wiki/sources/")) return "source note";
  if (path.startsWith("wiki/concepts/")) return "concept page";
  if (path.startsWith("wiki/entities/")) return "entity page";
  if (path.startsWith("wiki/synthesis/")) return "synthesis";
  return "wiki note";
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
  return mergeSourceFiles(state.files, [...state.editedRawFiles.values()])
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
  const files = state.files;
  if (els.queuePanel) els.queuePanel.hidden = files.length === 0;
  if (files.length === 0) {
    els.sourceList.className = "source-list empty";
    els.sourceList.textContent = "No new documents loaded.";
    return;
  }
  els.sourceList.className = "source-list";
  els.sourceList.innerHTML = files.map((file) => `
    <div class="source-item ${sourceClass(file)}">
      <button class="source-remove-btn" type="button" data-source-delete="${escapeHtml(file.name)}" aria-label="Remove ${escapeHtml(file.name)}">
        <span aria-hidden="true">×</span>
      </button>
      <span class="source-badge">${escapeHtml(sourceTypeLabel(file))}</span>
      <div class="source-copy">
        <strong>${escapeHtml(file.name)}</strong>
        ${renderSourceTimestamp(file)}
      </div>
      ${showTopSourceAction(file) ? renderSourceActionButton(file, "source-process-btn") : ""}
      ${renderSourceIngestRun(file)}
    </div>
  `).join("");
  bindSourceListControls();
}

function renderSourceTimestamp(file) {
  const date = sourceTimestampDate(file);
  if (!date) return "";
  return `<time class="source-timestamp" datetime="${escapeHtml(date.toISOString())}">${escapeHtml(formatSourceTimestamp(date))}</time>`;
}

function sourceTimestampDate(file) {
  const value = Number(file?.lastModified || 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatSourceTimestamp(date) {
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

function bindSourceListControls() {
  els.sourceList.querySelectorAll("[data-summary-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleSourceSummary(button.dataset.summaryToggle);
    });
  });
  els.sourceList.querySelectorAll("[data-run-answer]").forEach((button) => {
    const handleAnswer = (event) => {
      event.stopPropagation();
      setIngestReviewAnswer(button.dataset.file, button.dataset.question, button.dataset.answer);
    };
    button.addEventListener("click", handleAnswer);
    button.addEventListener("pointerup", handleAnswer);
  });
}

function renderSourceIngestRun(file) {
  const processingThis = state.processingInbox && (!state.processingFileName || state.processingFileName === file.name);
  const isReady = isSourceReviewReady(file) && !processingThis;
  const error = state.ingestErrors.get(file.name);
  if (!processingThis && !isReady && !error) return "";
  if (error && !processingThis) return renderSourceIngestError(file, error);
  const review = state.ingestReviews.get(file.name);
  return `
    <div class="source-ingest-run">
      <div class="run-steps">
        ${runStep("Raw source saved", isReady || rawSourceAlreadySaved(file), processingThis && !rawSourceAlreadySaved(file))}
        ${runStep(isReady ? modelReviewStepLabel(review) : pendingReviewStepLabel(file), isReady, processingThis && rawSourceAlreadySaved(file))}
        ${runStep(isReady ? "Questions ready" : "Checking what to ask", isReady, false)}
      </div>
      ${isReady ? renderSourceRunNotice(review) : ""}
      ${isReady && state.reviewMode !== "auto" ? `
        ${renderSourceSummary(file)}
        ${renderSourceConnections(file)}
      ` : ""}
      ${isReady ? renderSourceRunQuestions(file) : `
        ${renderProcessingIndicator(file)}
      `}
    </div>
  `;
}

function renderSourceIngestError(file, error) {
  return `
    <div class="source-ingest-run">
      <div class="run-error" role="status">
        <strong>Review did not finish</strong>
        <p>${escapeHtml(error)}</p>
      </div>
      ${renderSourceActionRow(file, { note: "Try again after reconnecting the vault or re-adding the file." })}
    </div>
  `;
}

function renderSourceRunNotice(review) {
  if (!review?.status) return "";
  if (isSpendGuardError(review.status)) {
    return `<div class="run-warning">${escapeHtml(review.status)}</div>`;
  }
  if (isRateLimitError(review.status)) {
    return `<div class="run-warning">Gemini is rate-limited right now, so Margins is showing the local review. Retry later for model-generated questions.</div>`;
  }
  return "";
}

function renderProcessingIndicator(file) {
  return `
    <div class="process-indicator" aria-label="Margins is working">
      <div class="process-line"><span></span></div>
      <div class="process-caption">
        <strong>${escapeHtml(pendingReviewStepLabel(file))}</strong>
        <span>${escapeHtml(pendingReviewNote(file))}</span>
      </div>
    </div>
  `;
}

function pendingReviewStepLabel(file) {
  return state.apiSecret && canSendSourceToModel(file) ? "Sending to model" : "Preparing review";
}

function pendingReviewNote(file) {
  if (state.apiSecret && canSendSourceToModel(file)) {
    return "Saved locally. Reading with vault context.";
  }
  if (needsTextExtraction(file)) {
    return "Saved locally. Checking readable text.";
  }
  return "Saved locally. Preparing review.";
}

function modelReviewStepLabel(review) {
  if (review?.source === "api") return `${providerLabel(review.provider || "gemini")} reviewed`;
  if (review?.source === "local") return "Local review ready";
  return "Summary ready";
}

function runStep(label, done, active) {
  return `
    <div class="run-step ${done ? "done" : ""} ${active ? "active" : ""}">
      <span></span>
      <strong>${escapeHtml(label)}</strong>
    </div>
  `;
}

function renderSourceRunQuestions(file) {
  const review = state.ingestReviews.get(file.name);
  const questions = review?.questions || currentIngestQuestionsForFile(file, state.currentFileMap, state.reviewMode);
  if (questions.length === 0) {
    return `
      <div class="run-note">Review complete.</div>
      ${renderSourceActionRow(file, { note: "File this source into the vault." })}
    `;
  }
  const answeredCount = questions.filter((question) => ingestAnswerFor(file.name, question.question)).length;
  return `
    <div class="run-conversation run-dialogue">
      ${questions.map((question, questionIndex) => `
        <div class="run-question run-prompt ${ingestAnswerFor(file.name, question.question) ? "answered" : ""}" data-question="${escapeHtml(question.question)}">
          <span class="run-prompt-meta">${escapeHtml(question.kind || `Question ${questionIndex + 1}`)}</span>
          <p class="run-prompt-question">${escapeHtml(question.question)}</p>
          ${question.recommendation ? `<div class="recommendation run-prompt-take">${escapeHtml(question.recommendation)}</div>` : ""}
          <div class="quick-actions">
            ${questionOptionsWithSkip(question).map((option, index) => {
              const selected = ingestAnswerFor(file.name, question.question) === option;
              return `
                <button class="quick-answer ${index === 0 ? "primary" : ""} ${selected ? "selected" : ""}" type="button" data-run-answer="${escapeHtml(option)}" data-question="${escapeHtml(question.question)}" data-file="${escapeHtml(file.name)}" aria-pressed="${selected ? "true" : "false"}" onclick="event.stopImmediatePropagation(); window.__marginsRunAnswer?.(this.dataset.file, this.dataset.question, this.dataset.runAnswer)">${escapeHtml(option)}</button>
              `;
            }).join("")}
          </div>
          ${ingestAnswerFor(file.name, question.question) ? `<div class="answered-note">Answered: ${escapeHtml(ingestAnswerFor(file.name, question.question))}</div>` : ""}
        </div>
      `).join("")}
    </div>
    ${renderSourceActionRow(file, {
      note: answeredCount === questions.length
        ? "Ready to file."
        : `${answeredCount}/${questions.length} answered. Skip anything that does not need your call.`
    })}
  `;
}

function showTopSourceAction(file) {
  return !isSourceReviewReady(file) && !state.ingestErrors.has(file?.name);
}

function renderSourceActionRow(file, { note = "" } = {}) {
  return `
    <div class="run-action-row">
      ${note ? `<span>${escapeHtml(note)}</span>` : "<span></span>"}
      ${renderSourceActionButton(file, "source-process-btn run-action-btn")}
    </div>
  `;
}

function renderSourceActionButton(file, className = "source-process-btn") {
  return `
    <button class="${escapeHtml(className)}" type="button" data-source-action="process" data-source-file="${escapeHtml(file.name)}" ${sourceProcessDisabled(file) ? "disabled" : ""}>
      ${escapeHtml(sourceProcessLabel(file))}
    </button>
  `;
}

function renderSourceSummary(file) {
  const fullSummary = sourceIngestFullSummary(file);
  const summaryBullets = sourceIngestSummaryBullets(file);
  const expanded = state.expandedSummaries.has(file.name);
  const canExpand = fullSummary.length > 240 || summaryBullets.length > 3;
  const visibleSummary = expanded || !canExpand ? fullSummary : clampSentence(fullSummary, 240);
  const visibleBullets = expanded ? summaryBullets : summaryBullets.slice(0, 3);
  return `
    <div class="run-summary run-brief ${expanded ? "expanded" : ""}">
      <div class="run-summary-head run-brief-head">
        <span class="run-kicker">Summary</span>
        ${canExpand ? `<button class="text-toggle" type="button" data-summary-toggle="${escapeHtml(file.name)}">${expanded ? "Show less" : "Show more"}</button>` : ""}
      </div>
      ${renderSummaryBrief(visibleSummary, visibleBullets)}
    </div>
  `;
}

function renderSummaryBrief(summary, bullets = []) {
  const cleanBullets = bullets.map((item) => cleanSummary(item)).filter(Boolean).slice(0, 5);
  if (cleanBullets.length) {
    const overview = summaryOverview(summary, cleanBullets);
    return `
      ${overview ? `<p class="run-brief-copy">${escapeHtml(overview)}</p>` : ""}
      <ul class="run-brief-points">
        ${cleanBullets.map((part) => `<li>${escapeHtml(part)}</li>`).join("")}
      </ul>
    `;
  }
  const parts = summarySentences(summary);
  if (parts.length <= 1) return `<p class="run-brief-copy">${escapeHtml(summary)}</p>`;
  return `
    <p class="run-brief-copy">${escapeHtml(parts[0])}</p>
    <ul class="run-brief-points">
      ${parts.slice(1).map((part) => `<li>${escapeHtml(part)}</li>`).join("")}
    </ul>
  `;
}

function summaryOverview(summary, bullets) {
  const clean = cleanSummary(summary);
  if (!clean) return "";
  let overview = clean;
  for (const bullet of bullets) {
    overview = overview.replace(bullet, "").trim();
  }
  overview = overview.replace(/\s{2,}/g, " ").replace(/^[,.;:\s-]+|[,.;:\s-]+$/g, "");
  if (!overview) return "";
  return clampSentence(overview, 220);
}

function summarySentences(summary) {
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

function summaryLabelSections(summary) {
  const clean = cleanSummary(summary);
  if (clean.length < 260) return clean ? [clean] : [];
  return clean
    .replace(/\s+(Date|Participants|Background|Opportunity|Assessment|Current status|Next steps|Risks|Decision|Follow-up|Context|Transcript)\b/g, "\n$1")
    .split(/\n+/)
    .map((part) => cleanSummary(part))
    .filter(Boolean)
    .slice(0, 8);
}

function renderSourceConnections(file) {
  const connections = state.ingestReviews.get(file.name)?.connections || [];
  if (connections.length === 0) return "";
  const visible = connections.slice(0, 6);
  const hiddenCount = Math.max(0, connections.length - visible.length);
  return `
    <div class="run-connections connection-strip">
      <span class="run-kicker">Connections</span>
      <div class="connection-chip-list">
        ${visible.map((connection) => `
          <span class="connection-chip" title="${escapeHtml(connection.reason || connection.path || "Useful context for this source.")}">
            ${escapeHtml(connection.title || titleFromSlug(basename(connection.path || "connection").replace(/\.md$/, "")))}
          </span>
        `).join("")}
        ${hiddenCount ? `<span class="connection-chip muted">+${hiddenCount} more</span>` : ""}
      </div>
    </div>
  `;
}

function questionOptionsWithSkip(question) {
  const options = question.options?.length ? question.options : ["Yes", "No", "Use default"];
  return options.some((option) => String(option).toLowerCase() === "skip")
    ? options
    : [...options, "Skip"];
}

function sourceIngestSummary(file) {
  return clampSentence(sourceIngestFullSummary(file), 340);
}

function sourceIngestFullSummary(file) {
  const review = state.ingestReviews.get(file.name);
  if (review?.summary) return stripTrailingEllipsis(cleanSummary(review.summary));
  const sourceNote = sourceNoteForFile(file);
  return stripTrailingEllipsis(cleanSummary(extractSourceSummary(sourceNote) || localSourceSummary(file) || "Margins preserved the raw source and prepared it for filing."));
}

function sourceIngestSummaryBullets(file) {
  const review = state.ingestReviews.get(file.name);
  if (review?.summaryBullets?.length) return review.summaryBullets.map((item) => cleanSummary(item)).filter(Boolean);
  const summary = sourceIngestFullSummary(file);
  const parts = summarySentences(summary);
  return parts.length > 2 ? parts.slice(1, 6) : [];
}

function stripTrailingEllipsis(value) {
  return String(value || "").replace(/\s*(?:\.{3}|…)\s*$/u, "").trim();
}

function clampSentence(value, limit) {
  const text = cleanSummary(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 3).trim()}...`;
}

function sourceNoteForFile(file) {
  return sourceNoteEntryForFile(file)?.body || "";
}

function extractSourceSummary(body) {
  if (!body) return "";
  const section = body.match(/## Summary\s+([\s\S]*?)(?:\n##\s|$)/);
  if (section?.[1]) return cleanSummary(section[1]);
  const yaml = body.match(/^summary:\s*("?)(.*?)\1\s*$/m);
  return yaml?.[2] ? cleanSummary(yaml[2]) : "";
}

function cleanSummary(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .trim();
}

function installTestHooks() {
  if (!new URLSearchParams(location.search).has("marginsTest")) return;
  globalThis.__marginsTest = {
    seedIngestCard({ summary, questions = [], connections = [] } = {}) {
      const file = {
        name: "browser-smoke-source.txt",
        text: "This is a browser smoke source for the ingest card.",
        type: "text",
        size: 51,
        sourceScope: "pending",
        extractionStatus: "ready",
        extractionError: ""
      };
      state.files = [file];
      state.pendingSave = true;
      state.processingInbox = false;
      state.currentFileMap = new Map([
        ["wiki/sources/source-browser-smoke-source.md", `---
type: source
summary: ${JSON.stringify(summary || "")}
raw_file: raw_sources/${file.name}
---

# Source: Browser Smoke Source

Raw file: \`raw_sources/${file.name}\`

## Summary

${summary || ""}
`]
      ]);
      state.ingestReviews = new Map([[file.name, {
        source: "api",
        status: "Model reviewed",
        summary: summary || "",
        connections,
        questions: questions.map((question) => reviewQuestion(
          "suggest",
          question.kind || "Quick check",
          `raw_sources/${file.name}`,
          question.question,
          question.reason || "Browser smoke question.",
          question.recommendation || "My take: use the best option.",
          question.options || ["Yes", "No", "Skip"]
        ))
      }]]);
      state.ingestAnswers = new Map();
      state.expandedSummaries = new Set();
      state.currentMaterialQuestions = state.ingestReviews.get(file.name).questions;
      renderSources();
      renderVaultTree(state.currentFileMap);
    },
    answerCount() {
      return state.ingestAnswers.size;
    },
    setApiGuard(settings = {}) {
      state.apiGuardSettings = normalizeApiGuardSettings(settings);
      state.apiUsage = emptyApiUsage();
      apiThrottle.startedAt = [];
      apiThrottle.lastStartedAt = 0;
      hydrateApiGuardControls();
    },
    apiUsage() {
      return { ...state.apiUsage };
    },
    seedTextModelSources(count = 3) {
      state.files = Array.from({ length: count }, (_, index) => ({
        name: `model-source-${index + 1}.txt`,
        text: `Readable source ${index + 1} with enough context for a model-generated filing review.`,
        type: "text",
        size: 86,
        lastModified: new Date(2026, 4, 5, 14, index).getTime(),
        sourceScope: "pending",
        extractionStatus: "ready",
        extractionError: ""
      }));
      state.vaultFiles = [];
      state.vaultHandle = createMemoryVaultHandle();
      state.vaultName = "Browser Test Vault";
      state.currentFileMap = new Map([["wiki/index.md", "# Index\n"]]);
      state.pendingSave = false;
      state.processingInbox = false;
      state.apiSecret = "test-gemini-key";
      state.ingestReviews = new Map();
      state.ingestErrors = new Map();
      state.apiUsage = emptyApiUsage();
      apiThrottle.startedAt = [];
      apiThrottle.lastStartedAt = 0;
      renderSources();
      updateActionState();
      return document.querySelector("#source-list")?.innerText || "";
    },
    seedDocxModelCallSource() {
      const rawSourceHandle = {
        async getFile() {
          return new File(["browser test docx attachment"], "pending-word.docx", {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            lastModified: new Date(2026, 4, 5, 9, 30).getTime()
          });
        }
      };
      state.files = [{
        name: "pending-word.docx",
        text: "",
        type: "docx",
        size: 12400,
        lastModified: new Date(2026, 4, 5, 9, 30).getTime(),
        rawSourceHandle,
        sourceScope: "vault",
        extractionStatus: "failed",
        extractionError: "No readable text found in DOCX."
      }];
      state.vaultFiles = [{ ...state.files[0], sourceScope: "vault", dirtyRaw: false }];
      state.vaultHandle = createMemoryVaultHandle();
      state.vaultName = "Browser Test Vault";
      state.currentFileMap = new Map([["wiki/index.md", "# Index\n"]]);
      state.pendingSave = false;
      state.processingInbox = false;
      state.ingestReviews = new Map();
      state.ingestErrors = new Map();
      renderSources();
      updateActionState();
      return document.querySelector("#source-list")?.innerText || "";
    },
    seedRichWikiContextSource() {
      const file = {
        name: "bob-casey-followup.txt",
        text: "Bob Casey followed up about Riviera, Santa Barbara Management, the GTM role, Alexa Harter, and whether Connor should keep this opportunity warm.",
        type: "text",
        size: 148,
        lastModified: new Date(2026, 4, 5, 15, 20).getTime(),
        sourceScope: "pending",
        extractionStatus: "ready",
        extractionError: ""
      };
      state.files = [file];
      state.vaultFiles = [];
      state.vaultHandle = createMemoryVaultHandle();
      state.vaultName = "Browser Test Vault";
      state.currentFileMap = new Map([
        ["wiki/index.md", `---
type: index
bucket: index
summary: Vault index.
tags: [index]
---

# Index

- [[riviera]]
- [[bob-casey]]
`],
        ["wiki/career/riviera.md", `---
type: entity
bucket: career
summary: New family-office operating-system company being built alongside SBM by Bob Casey. Connor was pitched a founding business/GTM role.
tags: [company, family-office, software, career-fork, briefly-adjacent, region/riviera, vibrance/peak]
status: active
priority: pinned
key_links: ["[[bob-casey]]", "[[santa-barbara-management]]", "[[briefly]]"]
updated: 2026-05-01
---

# Riviera

Family-office operating-system company being built by [[bob-casey]] alongside [[santa-barbara-management]].
`],
        ["wiki/projects/bob-casey.md", `---
type: entity
bucket: projects
summary: Bob Casey relationship and Riviera opportunity context.
tags: [person, career, riviera, vibrance/peak]
status: active
priority: pinned
key_links: ["[[riviera]]", "[[santa-barbara-management]]"]
updated: 2026-05-01
---

# Bob Casey

Bob is the founder/CEO contact for the [[riviera]] opportunity.
`],
        ["wiki/career/source-2026-04-24-connor-bob-casey.md", `---
type: source
bucket: career
summary: Follow-up Zoom with Bob Casey and Alexa Harter about SBM status and the Riviera role timeline.
tags: [source, meeting, bob-casey, riviera, career-fork]
key_links: ["[[bob-casey]]", "[[riviera]]", "[[santa-barbara-management]]"]
updated: 2026-04-24
---

# Source: Connor - Bob Casey / Alexa Harter

Second touch on the [[riviera]] founding-role conversation.
`],
        ["wiki/personal/unrelated-friend.md", `---
type: entity
bucket: personal
summary: Unrelated personal note.
tags: [person]
---

# Unrelated Friend
`]
      ]);
      state.pendingSave = false;
      state.processingInbox = false;
      state.apiSecret = "test-gemini-key";
      state.ingestReviews = new Map();
      state.ingestErrors = new Map();
      state.apiUsage = emptyApiUsage();
      apiThrottle.startedAt = [];
      apiThrottle.lastStartedAt = 0;
      renderSources();
      renderVaultTree(state.currentFileMap);
      updateActionState();
      return document.querySelector("#source-list")?.innerText || "";
    },
    seedVaultPendingSources() {
      const rawFiles = [
        {
          name: "filed-note.md",
          text: "Filed note already has a generated source note.",
          type: "text",
          size: 45,
          sourceScope: "vault",
          extractionStatus: "ready",
          extractionError: ""
        },
        {
          name: "unfiled-note.md",
          text: "Unfiled note exists in raw_sources but has not been ingested into wiki sources yet.",
          type: "text",
          size: 82,
          sourceScope: "vault",
          extractionStatus: "ready",
          extractionError: ""
        }
      ];
      const fileMap = new Map([
        ["wiki/sources/source-filed-note.md", `---
type: source
summary: Filed note.
raw_file: raw_sources/filed-note.md
---

# Source: Filed Note
`],
        ["wiki/index.md", "# Index\n"]
      ]);
      state.vaultFiles = rawFiles;
      state.files = pendingRawSourcesFromVault(fileMap, rawFiles);
      state.currentFileMap = fileMap;
      state.pendingSave = false;
      state.processingInbox = false;
      state.ingestReviews = new Map();
      state.ingestAnswers = new Map();
      renderSources();
      renderVaultTree(fileMap);
      return state.files.map((file) => file.name);
    },
    seedSourceStatusCards() {
      state.files = [
        {
          name: "pending-word.docx",
          text: "",
          type: "docx",
          size: 12400,
          lastModified: new Date(2026, 4, 5, 9, 30).getTime(),
          sourceScope: "vault",
          extractionStatus: "failed",
          extractionError: "No readable text found in DOCX."
        },
        {
          name: "pending-statement.pdf",
          text: "",
          type: "pdf",
          size: 88000,
          lastModified: new Date(2026, 4, 5, 10, 15).getTime(),
          sourceScope: "vault",
          extractionStatus: "needed",
          extractionError: ""
        },
        {
          name: "script/build.py",
          text: "print('hello margins')\n",
          type: "text",
          size: 23,
          lastModified: new Date(2026, 4, 5, 11, 0).getTime(),
          sourceScope: "vault",
          extractionStatus: "ready",
          extractionError: ""
        }
      ];
      state.vaultFiles = [];
      state.vaultHandle = createMemoryVaultHandle();
      state.vaultName = "Browser Test Vault";
      state.currentFileMap = new Map([["wiki/index.md", "# Index\n"]]);
      state.pendingSave = false;
      state.processingInbox = false;
      renderSources();
      updateActionState();
      return document.querySelector("#source-list")?.innerText || "";
    },
    processedReviewNames() {
      return (state.ingestReviews.size ? [...state.ingestReviews.keys()] : state.lastProcessedReviewNames).sort();
    },
    seedModelRequiredSource() {
      const file = {
        name: "scanned-source.pdf",
        text: "",
        type: "pdf",
        size: 32000,
        lastModified: new Date(2026, 4, 5, 12, 15).getTime(),
        browserFile: null,
        sourceScope: "pending",
        extractionStatus: "failed",
        extractionError: "No selectable text found."
      };
      state.files = [file];
      state.vaultFiles = [];
      state.vaultHandle = createMemoryVaultHandle();
      state.vaultName = "Browser Test Vault";
      state.currentFileMap = new Map([["wiki/index.md", "# Index\n"]]);
      state.pendingSave = false;
      state.processingInbox = false;
      state.apiSecret = "";
      state.ingestReviews = new Map();
      state.ingestErrors = new Map();
      renderSources();
      updateActionState();
      return document.querySelector("#source-list")?.innerText || "";
    },
    seedVaultPdfAttachmentSource() {
      const rawSourceHandle = {
        async getFile() {
          return new File(["%PDF-1.7\nfixture pdf body"], "saved-report.pdf", {
            type: "application/pdf",
            lastModified: new Date(2026, 4, 5, 13, 10).getTime()
          });
        }
      };
      const file = {
        name: "saved-report.pdf",
        text: "",
        type: "pdf",
        size: 24,
        lastModified: new Date(2026, 4, 5, 13, 10).getTime(),
        browserFile: null,
        rawSourceHandle,
        sourceScope: "vault",
        extractionStatus: "needed",
        extractionError: ""
      };
      state.files = [file];
      state.vaultFiles = [file];
      state.vaultHandle = createMemoryVaultHandle();
      state.vaultName = "Browser Test Vault";
      state.currentFileMap = new Map([["wiki/index.md", "# Index\n"]]);
      state.pendingSave = false;
      state.processingInbox = false;
      state.apiSecret = "test-gemini-key";
      state.ingestReviews = new Map();
      state.ingestErrors = new Map();
      renderSources();
      updateActionState();
      return document.querySelector("#source-list")?.innerText || "";
    },
    seedReadablePdfSource() {
      const file = {
        name: "text-layer-report.pdf",
        text: "This readable PDF covers a coding workflow, setup decisions, and follow-up tasks for the current vault.",
        type: "pdf",
        size: 42000,
        lastModified: new Date(2026, 4, 5, 13, 40).getTime(),
        browserFile: null,
        sourceScope: "vault",
        extractionStatus: "extracted",
        extractionError: ""
      };
      state.files = [file];
      state.vaultFiles = [file];
      state.vaultHandle = createMemoryVaultHandle();
      state.vaultName = "Browser Test Vault";
      state.currentFileMap = new Map([["wiki/index.md", "# Index\n"]]);
      state.pendingSave = false;
      state.processingInbox = false;
      state.apiSecret = "test-gemini-key";
      state.ingestReviews = new Map();
      state.ingestErrors = new Map();
      renderSources();
      updateActionState();
      return document.querySelector("#source-list")?.innerText || "";
    }
  };
}

function createMemoryVaultHandle() {
  const root = memoryDirectory("Browser Test Vault");
  return root;
}

function memoryDirectory(name) {
  const entries = new Map();
  return {
    kind: "directory",
    name,
    async getDirectoryHandle(childName, options = {}) {
      if (!entries.has(childName)) {
        if (!options.create) throw new Error(`Missing directory: ${childName}`);
        entries.set(childName, memoryDirectory(childName));
      }
      const entry = entries.get(childName);
      if (entry.kind !== "directory") throw new Error(`${childName} is not a directory`);
      return entry;
    },
    async getFileHandle(childName, options = {}) {
      if (!entries.has(childName)) {
        if (!options.create) throw new Error(`Missing file: ${childName}`);
        entries.set(childName, memoryFile(childName));
      }
      const entry = entries.get(childName);
      if (entry.kind !== "file") throw new Error(`${childName} is not a file`);
      return entry;
    },
    async removeEntry(childName) {
      entries.delete(childName);
    }
  };
}

function memoryFile(name) {
  let body = "";
  return {
    kind: "file",
    name,
    async getFile() {
      return new File([body], name, { lastModified: Date.now() });
    },
    async createWritable() {
      return {
        async write(value) {
          body = value instanceof Blob ? await value.text() : String(value || "");
        },
        async close() {}
      };
    }
  };
}

function sourceProcessLabel(file) {
  if (state.processingInbox && (!state.processingFileName || state.processingFileName === file?.name)) return "Processing...";
  if (state.ingestErrors.has(file?.name)) return "Retry";
  if (isSourceReviewReady(file)) return "Approve";
  return "Process";
}

function sourceProcessDisabled(file) {
  return state.processingInbox || state.files.some((file) => file.extractionStatus === "extracting");
}

function isSourceReviewReady(file) {
  return Boolean(file?.name && state.pendingSave && state.currentFileMap && state.ingestReviews.has(file.name) && !state.ingestErrors.has(file.name));
}

function renderVaultTree(fileMap = state.currentFileMap) {
  if (!els.vaultTree) return;
  const stats = ingestionStats(fileMap || new Map());
  els.vaultTree.innerHTML = `
    <div class="upload-stats">
      <div class="section-kicker">Ingestion</div>
      <div class="upload-stat-grid">
        ${uploadStat("Parsed", stats.parsedFiles)}
        ${uploadStat("Ingested", stats.ingestedFiles)}
        ${uploadStat("Pending", stats.pendingFiles)}
        ${uploadStat("Words", formatStatNumber(stats.totalWords))}
      </div>
      <div class="upload-detail-list">
        ${uploadDetail("Model calls", stats.modelCalls)}
        ${uploadDetail("Wiki notes", stats.wikiFiles)}
        ${uploadDetail("Cited links", stats.graphEdges)}
        ${uploadDetail("Needs extraction", stats.needsExtraction)}
        ${uploadDetail("Unsaved edits", stats.unsavedEdits)}
      </div>
    </div>
  `;
}

function ingestionStats(fileMap) {
  const sources = allSourceFiles();
  const parsedFiles = sources.filter((file) => wordCount(file.text || "") > 0).length;
  const unfiledRawCount = sources.filter((file) => !isRawSourceIngested(file, fileMap)).length;
  const pendingFiles = Math.max(state.files.length, unfiledRawCount);
  const ingestedFiles = sources.filter((file) => isRawSourceIngested(file, fileMap)).length;
  const totalWords = sources.reduce((sum, file) => sum + wordCount(file.text || ""), 0);
  const needsExtraction = sources.filter(needsTextExtraction).length;
  const modelCalls = state.apiUsage.requests;
  const wikiFiles = [...fileMap.keys()].filter((path) => path.startsWith("wiki/") && !path.startsWith("wiki/.margins/")).length;
  const graph = fileMap.size
    ? (fileMap === state.currentFileMap && graphView.nodes.length ? graphView : graphFromFileMap(fileMap))
    : { nodes: [], edges: [] };
  const unsavedEdits = state.hasUnsavedEdits
    ? 1
    : state.pendingSave
      ? fullChangePlan(state.loadedFileMap || new Map(), fileMap).filter((change) => change.status !== "unchanged").length
      : 0;
  return {
    parsedFiles,
    pendingFiles,
    ingestedFiles,
    totalWords,
    needsExtraction,
    modelCalls,
    wikiFiles,
    graphEdges: graph.edges.length,
    unsavedEdits
  };
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

function formatStatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function formatUsd(value) {
  return `$${Number(value || 0).toFixed(4).replace(/0+$/, "").replace(/\.$/, ".00")}`;
}

function sidebarFolderOrder(name) {
  return {
    raw_sources: 0,
    wiki: 1,
    commands: 2,
    agents: 3
  }[name] ?? 4;
}

function allSourceFiles() {
  const byName = new Map();
  for (const file of state.vaultFiles) byName.set(file.name, file);
  for (const file of state.files) byName.set(file.name, file);
  for (const file of state.editedRawFiles.values()) byName.set(file.name, file);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function rawFileForPath(path) {
  const normalizedPath = rawSourceOutputPath(path.replace(/^raw_sources\//, ""));
  return allSourceFiles().find((file) => rawSourceOutputPath(file.name) === normalizedPath) || null;
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
  els.workflowPanel?.classList.toggle("vault-connected", !!state.vaultHandle);
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
      guidance: `Ready to update ${state.vaultName}.`
    };
  }

  if (state.files.length === 0) {
    return {
      action: "sources",
      label: "Add documents",
      guidance: state.currentFileMap
        ? `Connected to ${state.vaultName}.`
        : `Connected to ${state.vaultName}.`
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
    label: "Process",
    guidance: failedPdfCount
      ? `${failedPdfCount} PDF${failedPdfCount === 1 ? "" : "s"} need to be attached in the LLM chat. The copied prompt will list them.`
      : state.currentFileMap
        ? "Review the new source against the existing vault, then ingest the proposed changes."
        : "Review the uploaded files, ask a few filing questions, then ingest them locally."
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
  const query = (els.vaultSearch?.value || "").trim().toLowerCase();
  const entries = vaultBrowserEntries(fileMap || new Map()).filter((entry) => (
    !query || entry.path.toLowerCase().includes(query) || entry.body.toLowerCase().includes(query)
  ));
  if (els.vaultTreeCount) els.vaultTreeCount.textContent = fileCountLabel(entries.length);

  if (entries.length === 0) {
    els.wikiTree.className = "tree-list empty";
    els.wikiTree.textContent = "Open a vault or add documents to browse raw_sources and wiki.";
    setDocumentHeader(null, "", { title: "No file selected", meta: "No file selected" });
    setDocBody("Open raw_sources or wiki, then choose a file.", { readOnly: true });
    if (els.docSaveBtn) els.docSaveBtn.disabled = true;
    return;
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
  setDocumentHeader(null, "", { title: "No file selected", meta: "No file selected" });
  setDocBody("Choose a file from raw_sources or wiki.", { readOnly: true });
  if (els.docSaveBtn) els.docSaveBtn.disabled = true;
}

function vaultBrowserEntries(fileMap) {
  const rawEntries = allSourceFiles().map((file) => ({
    path: rawSourceOutputPath(file.name),
    body: file.text || (file.type === "pdf" ? "PDF source preserved in raw_sources." : "Original file preserved in raw_sources."),
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
  return [...rawEntries, ...wikiEntries].sort((left, right) => left.path.localeCompare(right.path));
}

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
  return [...root.folders.entries()]
    .sort(([left], [right]) => sidebarFolderOrder(left) - sidebarFolderOrder(right) || left.localeCompare(right))
    .map(([name, node]) => renderVaultFolder(name, node, 0))
    .join("");
}

function renderVaultFolder(name, node, depth, parentPath = "") {
  const folderPath = parentPath ? `${parentPath}/${name}` : name;
  const hasQuery = !!(els.vaultSearch?.value || "").trim();
  const shouldOpen = hasQuery || state.selectedPath?.startsWith(`${folderPath}/`);
  const folders = [...node.folders.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([childName, childNode]) => renderVaultFolder(childName, childNode, depth + 1, folderPath))
    .join("");
  const files = node.files
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => `
      <button class="vault-file" type="button" data-path="${escapeHtml(file.path)}" style="--depth: ${depth + 1}">
        <span>${escapeHtml(basename(file.path))}</span>
      </button>
    `).join("");
  return `
    <details class="vault-folder" style="--depth: ${depth}"${shouldOpen ? " open" : ""}>
      <summary><span>${escapeHtml(name)}</span></summary>
      ${folders}${files}
    </details>
  `;
}

function vaultFolderCount(node) {
  let count = node.files.length;
  for (const child of node.folders.values()) count += vaultFolderCount(child);
  return count;
}

function selectVaultPath(path, options = {}) {
  const normalizedPath = normalizeMarginsPath(path);
  const rawFile = rawFileForPath(normalizedPath);
  if (rawFile) {
    state.selectedPath = rawSourceOutputPath(rawFile.name);
    state.selectedKind = "raw";
    const body = rawFile.text || (rawFile.type === "pdf" ? "PDF source preserved in raw_sources." : "Original file preserved in raw_sources.");
    const readOnly = (rawFile.type === "pdf" || rawFile.type === "attachment") && !rawFile.text;
    setDocumentHeader(state.selectedPath, body, { kind: "raw", readOnly });
    setDocBody(body, { readOnly });
    updateSelectedFileState(options);
    return true;
  }

  if (state.currentFileMap?.has(normalizedPath)) {
    state.selectedPath = normalizedPath;
    state.selectedKind = normalizedPath.startsWith("wiki/") ? "wiki" : "system";
    const body = state.currentFileMap.get(normalizedPath);
    setDocumentHeader(normalizedPath, body, { kind: state.selectedKind, readOnly: false });
    setDocBody(body, { readOnly: false });
    updateSelectedFileState(options);
    return true;
  }

  return false;
}

function updateSelectedFileState(options = {}) {
  els.wikiTree?.querySelectorAll(".vault-file").forEach((item) => {
    item.classList.toggle("active", item.dataset.path === state.selectedPath);
  });
  if (!options.preserveFocus && document.activeElement !== els.docBody) {
    els.docBody?.focus({ preventScroll: true });
  }
  updateSaveButtonState();
}

function fileCountLabel(count) {
  return `${count} file${count === 1 ? "" : "s"}`;
}

function setDocumentHeader(path, body = "", options = {}) {
  if (els.docPath) els.docPath.textContent = path ? documentBreadcrumb(path) : "Vault";
  if (els.docTitle) els.docTitle.textContent = options.title || (path ? documentTitle(path) : "No file selected");
  if (els.docMeta) {
    const words = wordCount(body);
    els.docMeta.textContent = options.meta || (path
      ? `${documentKindLabel(options.kind || state.selectedKind || pathKind(path))} · ${words} word${words === 1 ? "" : "s"} · ${options.readOnly ? "read only" : "editable"}`
      : "No file selected");
  }
}

function documentBreadcrumb(path) {
  const parts = normalizeMarginsPath(path).split("/");
  return parts.length > 1 ? parts.slice(0, -1).join(" / ") : "Vault";
}

function documentTitle(path) {
  return basename(path).replace(/\.md$/i, "");
}

function pathKind(path) {
  return path.startsWith("raw_sources/") ? "raw" : path.startsWith("wiki/") ? "wiki" : "system";
}

function documentKindLabel(kind) {
  return {
    raw: "Raw source",
    wiki: "Wiki note",
    system: "Operating file"
  }[kind] || "Vault file";
}

function setDocBody(body, options = {}) {
  if ("value" in els.docBody) {
    els.docBody.value = body || "";
    els.docBody.readOnly = !!options.readOnly;
  } else {
    els.docBody.textContent = body || "";
  }
  els.docBody.classList.toggle("read-only", !!options.readOnly);
  renderDocHighlight();
}

function docBodyValue() {
  return "value" in els.docBody ? els.docBody.value : els.docBody.textContent;
}

function renderDocHighlight() {
  if (!els.docHighlight || !els.docBody) return;
  els.docHighlight.innerHTML = highlightMarkdown(docBodyValue());
  syncDocHighlightScroll();
}

function syncDocHighlightScroll() {
  if (!els.docHighlight || !els.docBody) return;
  els.docHighlight.scrollTop = els.docBody.scrollTop;
  els.docHighlight.scrollLeft = els.docBody.scrollLeft;
}

function highlightMarkdown(body) {
  const lines = String(body || "").split("\n");
  let inFrontmatter = false;
  return lines.map((line, index) => {
    const trimmed = line.trim();
    if (index === 0 && trimmed === "---") {
      inFrontmatter = true;
      return `<span class="markdown-frontmatter markdown-delimiter">${escapeHtml(line || " ")}</span>`;
    }
    if (inFrontmatter && trimmed === "---") {
      inFrontmatter = false;
      return `<span class="markdown-frontmatter markdown-delimiter">${escapeHtml(line || " ")}</span>`;
    }
    if (inFrontmatter) {
      return `<span class="markdown-frontmatter">${highlightPropertyLine(line)}</span>`;
    }
    if (/^#{1,6}\s/.test(line)) {
      return `<span class="markdown-heading">${highlightInlineMarkdown(line)}</span>`;
    }
    return `<span>${highlightInlineMarkdown(line || " ")}</span>`;
  }).join("\n");
}

function highlightPropertyLine(line) {
  const match = line.match(/^(\s*)([A-Za-z0-9_-]+)(:)(.*)$/);
  if (!match) return highlightInlineMarkdown(line || " ");
  const [, leading, key, colon, value] = match;
  return `${escapeHtml(leading)}<span class="markdown-property-key">${escapeHtml(key)}</span><span class="markdown-property-punctuation">${escapeHtml(colon)}</span><span class="markdown-property-value">${highlightInlineMarkdown(value || "")}</span>`;
}

function highlightInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/(`[^`\n]+`)/g, '<span class="markdown-code">$1</span>')
    .replace(/(\*\*[^*\n]+\*\*)/g, '<span class="markdown-strong">$1</span>')
    .replace(/(\[\[[^\]\n]+\]\])/g, '<span class="markdown-link">$1</span>')
    .replace(/(\[[^\]\n]+\]\([^)]+\))/g, '<span class="markdown-link">$1</span>')
    .replace(/(https?:\/\/[^\s)]+)/g, '<span class="markdown-link">$1</span>');
}

function handleVaultDocumentEdit() {
  if (!state.selectedPath || els.docBody.readOnly) return;
  const body = docBodyValue();
  if (state.selectedKind === "raw") {
    const file = rawFileForPath(state.selectedPath);
    if (!file) return;
    file.text = body;
    state.editedRawFiles.set(file.name, {
      ...file,
      text: body,
      browserFile: null,
      extractionStatus: "ready",
      sourceScope: "vault",
      dirtyRaw: true
    });
  } else if (state.currentFileMap?.has(state.selectedPath)) {
    state.currentFileMap.set(state.selectedPath, body);
  } else {
    return;
  }
  state.hasUnsavedEdits = true;
  state.pendingSave = true;
  setDocumentHeader(state.selectedPath, body, { kind: state.selectedKind, readOnly: false });
  renderDocHighlight();
  renderVaultTree(state.currentFileMap);
  updateSaveButtonState();
  renderChangePreview();
}

function renderLlmReview() {
  const entries = [...state.llmFiles.entries()];
  const warningsByPath = validateLlmFiles(state.llmFiles);
  const questions = limitMaterialQuestions(buildMaterialQuestions(state.llmFiles, warningsByPath, state.reviewMode), state.reviewMode);
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
      ? "No blockers found. Ready to write."
      : "No questions needed. Ready to write.";
    updateInlineReviewVisibility();
    return;
  }

  els.reviewQuestions.className = "review-list";
  els.reviewQuestions.innerHTML = questions.map((question) => `
    <div class="review-card ${question.severity}" data-question="${escapeHtml(question.question)}">
      <div class="review-meta">${escapeHtml(question.kind)}</div>
      <strong>${escapeHtml(question.question)}</strong>
      <div class="recommendation">${escapeHtml(question.recommendation)}</div>
      <div class="quick-actions">
        ${(question.options || ["Yes", "No", "Use default"]).map((option, index) => `
          <button class="quick-answer ${index === 0 ? "primary" : ""}" type="button" data-answer="${escapeHtml(option)}">${escapeHtml(option)}</button>
        `).join("")}
      </div>
    </div>
  `).join("");
  els.reviewReply.hidden = false;
  els.reviewResponseBtn.hidden = state.llmFiles.size === 0;

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
  updateInlineReviewVisibility();
}

function updateInlineReviewVisibility() {
  if (!els.inlineReviewPanel) return;
  if (state.files.length > 0 && (state.processingInbox || (state.pendingSave && state.currentFileMap))) {
    els.inlineReviewPanel.hidden = true;
    els.reviewResponseBtn.hidden = true;
    return;
  }
  const hasQuestions = state.currentMaterialQuestions.length > 0;
  const hasPendingSave = state.pendingSave && state.currentFileMap;
  const hasPreview = Boolean(els.changePreview.innerHTML.trim());
  els.inlineReviewPanel.hidden = !(hasQuestions || hasPendingSave || hasPreview);
  els.reviewResponseBtn.hidden = state.llmFiles.size === 0;
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

  if (state.files.length > 0) {
    return limitMaterialQuestions(state.files.flatMap((file) => currentIngestQuestionsForFile(file, fileMap, mode)), mode);
  }

  const questions = [
    ...riskQuestions(fileMap),
    ...synthesisQuestions(fileMap)
  ];

  if (mode === "strict") {
    questions.push(...strictReviewQuestions(fileMap));
  }

  return limitMaterialQuestions(questions, mode);
}

function limitMaterialQuestions(questions, mode) {
  const limit = 3;
  return dedupeQuestions(questions).slice(0, limit);
}

function currentIngestQuestionsForFile(file, fileMap, mode) {
  if (mode === "auto") return [];

  if (needsTextExtraction(file)) {
    return [];
  }

  const currentSourceMap = currentSourceNoteMap(fileMap, file);
  const questions = riskQuestions(currentSourceMap).slice(0, 1);
  if (mode === "strict" && questions.length === 0) return [];
  return questions;
}

function currentSourceNoteMap(fileMap, file = null) {
  if (!fileMap || (state.files.length === 0 && !file)) return fileMap || new Map();
  const rawPaths = new Set(file ? [`raw_sources/${file.name}`] : state.files.map((source) => `raw_sources/${source.name}`));
  const entries = [...fileMap.entries()].filter(([path, body]) => (
    path.startsWith("wiki/sources/") && [...rawPaths].some((rawPath) => body.includes(rawPath))
  ));
  return new Map(entries);
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
  const entities = [];
  const concepts = [];
  for (const [path, body] of fileMap.entries()) {
    if (path.startsWith("wiki/entities/")) {
      const title = markdownTitle(body) || titleFromSlug(basename(path).replace(/\.md$/, ""));
      const demoLike = /\bdemo\b|\bfictional\b|\bplaceholder\b|\bnot an actual\b|\bexample\b/i.test(body);
      if (!demoLike && isUsefulPromotionTitle(title)) entities.push({ title, path });
    }
    if (path.startsWith("wiki/concepts/")) {
      const title = markdownTitle(body) || titleFromSlug(basename(path).replace(/\.md$/, ""));
      if (isUsefulPromotionTitle(title)) concepts.push({ title, path });
    }
  }
  const candidates = [...entities, ...concepts].slice(0, 4);
  if (candidates.length === 0) return [];
  const names = candidates.map((candidate) => candidate.title).join(", ");
  return [reviewQuestion(
    "suggest",
    "Quick check",
    candidates[0].path,
    `Keep reusable pages for ${names}?`,
    "Margins can connect future files to these pages, but if they are one-off labels I can keep them inside the source note.",
    "My take: keep the default unless these look like throwaway labels.",
    ["Keep pages", "Source only", "Use default"]
  )];
}

function isUsefulPromotionTitle(title) {
  const clean = String(title || "").replace(/^Concept:\s*/i, "").trim();
  if (clean.length < 4) return false;
  if (/^[A-Z]{1,4}$/.test(clean)) return false;
  if (!/[a-zA-Z]/.test(clean)) return false;
  if (/^(n\/a|none|null|unknown|untitled|demo|example|sample)$/i.test(clean)) return false;
  return true;
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
    const key = `${question.kind}:${question.question}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validateLlmFiles(fileMap) {
  const warningsByPath = new Map();
  const entries = [...fileMap.entries()];
  const promotedPages = entries.filter(([path]) => (
    isPromotedWikiPagePath(path)
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
    if (isSourceNodePagePath(path)) {
      if (!/##\s+Mentioned but missing/i.test(body)) warnings.push("Source page is missing a Mentioned but missing section.");
      if (!/##\s+Inferences refused/i.test(body)) warnings.push("Source page is missing an Inferences refused section.");
      if (hasPromotedPages && extractWikiLinks(body).length === 0) {
        warnings.push("Source page does not link to promoted concepts, entities, or synthesis pages.");
      }
    }
    if (isPromotedWikiPagePath(path) && !body.includes("[[source-")) {
      warnings.push("Promoted page does not link back to a source page.");
    }
    if (path.startsWith("wiki/entities/") && !isBucketOverviewPath(path) && /\bfictional\b|\bdemo\b|\bis this a real\b/i.test(body)) {
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
  return (/^wiki\/(sources|concepts|entities|synthesis)\/[^/]+\.md$/.test(path) ||
    /^wiki\/(ingest-tracker|log|wiki-stats)\.md$/.test(path) ||
    path === "wiki/index.md");
}

function isSourceNodePagePath(path) {
  return path.startsWith("wiki/sources/") && !isBucketOverviewPath(path);
}

function isPromotedWikiPagePath(path) {
  return (
    path.startsWith("wiki/concepts/") ||
    path.startsWith("wiki/entities/") ||
    path.startsWith("wiki/synthesis/")
  ) && !isBucketOverviewPath(path);
}

function isBucketOverviewPath(path) {
  return /^wiki\/(sources\/sources|concepts\/concepts|entities\/entities|synthesis\/synthesis)\.md$/.test(path);
}

function warningLabel(warnings) {
  return warnings.length ? ` · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : "";
}

function drawGraph(graph) {
  setupGraphInteractions();
  if (!graph || graph.nodes.length === 0) {
    stopGraphSimulation();
    graphView.nodes = [];
    graphView.edges = [];
    graphView.selectedId = "";
    graphView.hoverId = "";
    graphView.transform = { x: 0, y: 0, k: 1 };
    updateGraphSelection();
    els.graphSvg.setAttribute("viewBox", `0 0 ${graphView.width} ${graphView.height}`);
    els.graphSvg.innerHTML = `
      <rect class="graph-backdrop" width="${graphView.width}" height="${graphView.height}" />
      <text class="graph-empty" x="${graphView.width / 2}" y="${graphView.height / 2}" text-anchor="middle">No accepted graph nodes yet.</text>
    `;
    return;
  }

  const previous = new Map(graphView.nodes.map((node) => [node.id, node]));
  const degree = new Map(graph.nodes.map((node) => [node.id, 0]));
  graph.edges.forEach((edge) => {
    degree.set(edge.from, (degree.get(edge.from) || 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) || 0) + 1);
  });

  graphView.nodes = graph.nodes.map((node, index) => {
    const prior = previous.get(node.id);
    const seeded = seededGraphPoint(node, index, graph.nodes.length);
    return {
      ...node,
      path: graphNodePath(node),
      degree: degree.get(node.id) || 0,
      x: prior?.x ?? seeded.x,
      y: prior?.y ?? seeded.y,
      vx: prior?.vx ?? 0,
      vy: prior?.vy ?? 0
    };
  });
  const byId = new Map(graphView.nodes.map((node) => [node.id, node]));
  graphView.edges = graph.edges
    .map((edge) => ({ ...edge, source: byId.get(edge.from), target: byId.get(edge.to) }))
    .filter((edge) => edge.source && edge.target);
  if (!graphView.nodes.some((node) => node.id === graphView.selectedId)) graphView.selectedId = "";
  graphView.hoverId = "";
  els.graphSvg.setAttribute("viewBox", `0 0 ${graphView.width} ${graphView.height}`);
  updateGraphSelection();
  renderGraphFrame();
  startGraphSimulation(0.95);
}

function setupGraphInteractions() {
  if (graphView.bound) return;
  graphView.bound = true;

  els.graphSvg.addEventListener("pointerdown", (event) => {
    const node = graphNodeFromEvent(event);
    const point = graphPointer(event);
    if (node) {
      graphView.pointer = {
        type: "node",
        id: node.id,
        startX: point.x,
        startY: point.y,
        offsetX: node.x - point.x,
        offsetY: node.y - point.y,
        moved: false
      };
      selectGraphNode(node.id, { open: false });
      startGraphSimulation(0.55);
    } else {
      graphView.pointer = {
        type: "pan",
        startX: event.clientX,
        startY: event.clientY,
        x: graphView.transform.x,
        y: graphView.transform.y,
        moved: false
      };
    }
    els.graphSvg.setPointerCapture?.(event.pointerId);
  });

  els.graphSvg.addEventListener("pointermove", (event) => {
    const active = graphView.pointer;
    if (active?.type === "node") {
      const node = graphView.nodes.find((item) => item.id === active.id);
      if (!node) return;
      const point = graphPointer(event);
      node.x = point.x + active.offsetX;
      node.y = point.y + active.offsetY;
      node.vx = 0;
      node.vy = 0;
      active.moved = active.moved || Math.hypot(point.x - active.startX, point.y - active.startY) > 4;
      renderGraphFrame();
      return;
    }

    if (active?.type === "pan") {
      const dx = event.clientX - active.startX;
      const dy = event.clientY - active.startY;
      graphView.transform.x = active.x + dx * (graphView.width / Math.max(els.graphSvg.clientWidth, 1));
      graphView.transform.y = active.y + dy * (graphView.height / Math.max(els.graphSvg.clientHeight, 1));
      active.moved = active.moved || Math.hypot(dx, dy) > 4;
      renderGraphFrame();
      return;
    }

    const hoverNode = graphNodeFromEvent(event);
    const nextHoverId = hoverNode?.id || "";
    if (nextHoverId !== graphView.hoverId) {
      graphView.hoverId = nextHoverId;
      renderGraphFrame();
    }
  });

  els.graphSvg.addEventListener("pointerup", (event) => {
    const active = graphView.pointer;
    if (active?.type === "node") {
      selectGraphNode(active.id, { open: false });
    }
    graphView.pointer = null;
    els.graphSvg.releasePointerCapture?.(event.pointerId);
  });

  els.graphSvg.addEventListener("pointerleave", () => {
    if (graphView.pointer) return;
    graphView.hoverId = "";
    renderGraphFrame();
  });

  els.graphSvg.addEventListener("dblclick", (event) => {
    const node = graphNodeFromEvent(event);
    if (node) {
      openGraphNode(node);
      return;
    }
    resetGraphCamera();
  });

  els.graphSvg.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomGraph(event, event.deltaY < 0 ? 1.12 : 0.9);
  }, { passive: false });
}

function startGraphSimulation(alpha = 0.7) {
  graphView.alpha = Math.max(graphView.alpha, alpha);
  if (graphView.raf) return;
  graphView.raf = requestAnimationFrame(runGraphSimulation);
}

function stopGraphSimulation() {
  if (graphView.raf) cancelAnimationFrame(graphView.raf);
  graphView.raf = 0;
  graphView.alpha = 0;
}

function runGraphSimulation() {
  graphView.raf = 0;
  if (graphView.nodes.length === 0 || graphView.alpha < 0.012) {
    graphView.alpha = 0;
    renderGraphFrame();
    return;
  }

  tickGraphForces();
  renderGraphFrame();
  graphView.alpha *= 0.982;
  graphView.raf = requestAnimationFrame(runGraphSimulation);
}

function tickGraphForces() {
  const nodes = graphView.nodes;
  const alpha = graphView.alpha;
  const centerX = graphView.width / 2;
  const centerY = graphView.height / 2;

  for (let i = 0; i < nodes.length; i += 1) {
    const left = nodes[i];
    for (let j = i + 1; j < nodes.length; j += 1) {
      const right = nodes[j];
      let dx = right.x - left.x;
      let dy = right.y - left.y;
      let distanceSq = dx * dx + dy * dy;
      if (distanceSq < 0.01) {
        dx = ((hashString(left.id) % 17) - 8) / 10;
        dy = ((hashString(right.id) % 19) - 9) / 10;
        distanceSq = dx * dx + dy * dy;
      }
      const distance = Math.sqrt(distanceSq);
      const minDistance = nodeRadius(left.type, left.degree) + nodeRadius(right.type, right.degree) + 18;
      const charge = (920 * alpha) / Math.max(distanceSq, 90);
      const nx = dx / distance;
      const ny = dy / distance;
      left.vx -= nx * charge;
      left.vy -= ny * charge;
      right.vx += nx * charge;
      right.vy += ny * charge;

      if (distance < minDistance) {
        const collision = (minDistance - distance) * 0.022 * alpha;
        left.vx -= nx * collision;
        left.vy -= ny * collision;
        right.vx += nx * collision;
        right.vy += ny * collision;
      }
    }
  }

  for (const edge of graphView.edges) {
    const source = edge.source;
    const target = edge.target;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
    const desired = graphLinkDistance(source, target);
    const force = (distance - desired) * 0.018 * alpha;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    source.vx += fx;
    source.vy += fy;
    target.vx -= fx;
    target.vy -= fy;
  }

  for (const node of nodes) {
    const home = graphNodeHome(node);
    node.vx += (home.x - node.x) * 0.0024 * alpha;
    node.vy += (home.y - node.y) * 0.0024 * alpha;
    node.vx += (centerX - node.x) * 0.00035 * alpha;
    node.vy += (centerY - node.y) * 0.00035 * alpha;
    node.vx *= 0.86;
    node.vy *= 0.86;
    node.x = clamp(node.x + node.vx, 44, graphView.width - 44);
    node.y = clamp(node.y + node.vy, 44, graphView.height - 44);
  }
}

function renderGraphFrame() {
  const activeId = graphView.hoverId || graphView.selectedId;
  const relatedIds = activeId ? graphRelatedIds(activeId) : new Set();
  const transform = graphView.transform;
  const edgeSvg = graphView.edges.map((edge) => {
    const active = activeId && (edge.from === activeId || edge.to === activeId);
    const faded = activeId && !active;
    return `
      <line class="graph-edge${active ? " active" : ""}${faded ? " faded" : ""}"
        x1="${edge.source.x.toFixed(2)}" y1="${edge.source.y.toFixed(2)}"
        x2="${edge.target.x.toFixed(2)}" y2="${edge.target.y.toFixed(2)}" />
    `;
  }).join("");

  const nodeSvg = graphView.nodes.map((node) => {
    const selected = node.id === graphView.selectedId;
    const hovered = node.id === graphView.hoverId;
    const related = relatedIds.has(node.id);
    const faded = activeId && !selected && !hovered && !related;
    const radius = nodeRadius(node.type, node.degree);
    return `
      <g class="graph-node${selected ? " selected" : ""}${hovered ? " hovered" : ""}${related ? " related" : ""}${faded ? " faded" : ""}"
        data-id="${escapeHtml(node.id)}" style="color: ${nodeColor(node.type)}" transform="translate(${node.x.toFixed(2)} ${node.y.toFixed(2)})" tabindex="0" role="button">
        <circle class="node-glow" r="${(radius + 9).toFixed(2)}" />
        <circle class="node-core" r="${radius.toFixed(2)}" fill="${nodeColor(node.type)}" />
        <circle class="node-rim" r="${radius.toFixed(2)}" />
        <text class="node-label" x="${(radius + 10).toFixed(2)}" y="4">${escapeHtml(shortLabel(node.title))}</text>
        <title>${escapeHtml(node.title)}</title>
      </g>
    `;
  }).join("");

  els.graphSvg.innerHTML = `
    <defs>
      <radialGradient id="graph-vignette" cx="50%" cy="48%" r="72%">
        <stop offset="0%" stop-color="#20202a" />
        <stop offset="72%" stop-color="#15161d" />
        <stop offset="100%" stop-color="#101116" />
      </radialGradient>
    </defs>
    <rect class="graph-backdrop" width="${graphView.width}" height="${graphView.height}" />
    <g class="graph-camera" transform="translate(${transform.x.toFixed(2)} ${transform.y.toFixed(2)}) scale(${transform.k.toFixed(3)})">
      <g class="graph-edge-layer">${edgeSvg}</g>
      <g class="graph-node-layer">${nodeSvg}</g>
    </g>
  `;
}

function graphPointer(event) {
  const svgPoint = graphSvgPoint(event);
  return {
    x: (svgPoint.x - graphView.transform.x) / graphView.transform.k,
    y: (svgPoint.y - graphView.transform.y) / graphView.transform.k
  };
}

function graphSvgPoint(event) {
  const rect = els.graphSvg.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / Math.max(rect.width, 1)) * graphView.width,
    y: ((event.clientY - rect.top) / Math.max(rect.height, 1)) * graphView.height
  };
}

function graphNodeFromEvent(event) {
  const element = event.target.closest?.(".graph-node");
  if (!element) return null;
  const id = element.dataset.id;
  return graphView.nodes.find((node) => node.id === id) || null;
}

function selectGraphNode(id, options = {}) {
  graphView.selectedId = id;
  graphView.hoverId = "";
  updateGraphSelection();
  renderGraphFrame();
  if (options.open) {
    const node = graphView.nodes.find((item) => item.id === id);
    if (node) openGraphNode(node);
  }
}

function updateGraphSelection() {
  if (!els.graphSelection) return;
  const node = graphView.nodes.find((item) => item.id === graphView.selectedId);
  els.graphSelection.hidden = !node;
  if (!node) return;
  els.graphSelectionMeta.textContent = graphNodeTypeLabel(node.type);
  els.graphSelectionTitle.textContent = node.title;
}

function openSelectedGraphNode() {
  const node = graphView.nodes.find((item) => item.id === graphView.selectedId);
  if (node) openGraphNode(node);
}

function openGraphNode(node) {
  const path = graphNodePath(node);
  if (!path || !state.currentFileMap?.has(path)) return;
  activateTab("wiki");
  selectVaultPath(path);
}

function resetGraphCamera() {
  graphView.transform = { x: 0, y: 0, k: 1 };
  startGraphSimulation(0.35);
  renderGraphFrame();
}

function zoomGraph(event, factor) {
  const point = graphSvgPoint(event);
  const old = graphView.transform;
  const nextK = clamp(old.k * factor, 0.45, 2.7);
  const graphX = (point.x - old.x) / old.k;
  const graphY = (point.y - old.y) / old.k;
  graphView.transform = {
    x: point.x - graphX * nextK,
    y: point.y - graphY * nextK,
    k: nextK
  };
  renderGraphFrame();
}

function graphRelatedIds(id) {
  const related = new Set([id]);
  graphView.edges.forEach((edge) => {
    if (edge.from === id) related.add(edge.to);
    if (edge.to === id) related.add(edge.from);
  });
  return related;
}

function seededGraphPoint(node, index, total) {
  const home = graphNodeHome(node);
  const seed = hashString(node.id || node.title || index);
  const angle = ((seed % 360) / 360) * Math.PI * 2;
  const spread = Math.min(240, 80 + total * 8);
  return {
    x: clamp(home.x + Math.cos(angle) * spread * (0.45 + ((seed % 13) / 30)), 60, graphView.width - 60),
    y: clamp(home.y + Math.sin(angle) * spread * (0.45 + ((seed % 17) / 34)), 60, graphView.height - 60)
  };
}

function graphNodeHome(node) {
  const width = graphView.width;
  const height = graphView.height;
  return {
    index: { x: width * 0.5, y: height * 0.48 },
    source: { x: width * 0.29, y: height * 0.58 },
    concept: { x: width * 0.52, y: height * 0.38 },
    entity: { x: width * 0.72, y: height * 0.55 },
    synthesis: { x: width * 0.56, y: height * 0.68 }
  }[node.type] || { x: width * 0.5, y: height * 0.5 };
}

function graphLinkDistance(source, target) {
  const sourceRadius = nodeRadius(source.type, source.degree);
  const targetRadius = nodeRadius(target.type, target.degree);
  const typeBonus = source.type === target.type ? 30 : 0;
  return sourceRadius + targetRadius + 92 + typeBonus;
}

function graphNodePath(node) {
  if (node.path) return node.path;
  if (node.id === "index" || node.type === "index") return "wiki/index.md";
  if (/^(sources|concepts|entities|synthesis)\//.test(node.id)) return `wiki/${node.id}.md`;
  const bucket = {
    source: "sources",
    concept: "concepts",
    entity: "entities",
    synthesis: "synthesis"
  }[node.type];
  return bucket ? `wiki/${bucket}/${node.id}.md` : "";
}

function graphNodeTypeLabel(type) {
  return {
    index: "Index",
    source: "Source",
    concept: "Concept",
    entity: "Entity",
    synthesis: "Synthesis"
  }[type] || "Node";
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
      path,
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
  const isDocx = /\.docx$/i.test(file.name);
  const isReadableText = isReadableSourceTextPath(file.name);
  const base = {
    name: file.webkitRelativePath || file.name,
    browserFile: file,
    size: file.size,
    lastModified: file.lastModified,
    extractionError: ""
  };

  if (isPdf) {
    return {
      ...base,
      text: "",
      type: "pdf",
      extractionStatus: "needed"
    };
  }

  if (isDocx) {
    try {
      const text = await extractDocxText(file);
      return {
        ...base,
        text,
        type: "docx",
        extractionStatus: text ? "extracted" : "failed",
        extractionError: text ? "" : "No readable text found in DOCX."
      };
    } catch (error) {
      return {
        ...base,
        text: "",
        type: "docx",
        extractionStatus: "failed",
        extractionError: error.message || "DOCX extraction failed."
      };
    }
  }

  if (!isReadableText) {
    return {
      ...base,
      text: "",
      type: "attachment",
      extractionStatus: "needed",
      extractionError: "Needs model review from the original file."
    };
  }

  return {
    ...base,
    text: await file.text(),
    type: "text",
    extractionStatus: "ready"
  };
}

async function extractDocxText(file) {
  const mammoth = globalThis.mammoth;
  if (!mammoth?.extractRawText) {
    throw new Error("DOCX extraction library did not load.");
  }
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return cleanExtractedText(result.value || "");
}

function cleanExtractedText(value) {
  return String(value || "")
    .replace(/\u0000/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
    await extractPdfTextForSource(file);
  }

  els.extractBtn.textContent = "Extract PDF text";
  renderSources();
  updateActionState();
  els.stats.textContent = state.currentFileMap
    ? `${state.files.length} new source${state.files.length === 1 ? "" : "s"} ready · existing wiki retained`
    : `${state.files.length} source${state.files.length === 1 ? "" : "s"} loaded · 0 nodes · 0 edges`;
  updateWorkflowState();
}

async function extractPdfTextForSource(file) {
  if (!file || file.type !== "pdf" || file.text) return;
  file.extractionStatus = "extracting";
  file.extractionError = "";
  try {
    const blob = await refreshRawSourceBlobFromVault(file) || file.browserFile;
    if (!blob) throw new Error("Original PDF is not available.");
    const text = await extractPdfText(blob);
    file.text = text.trim();
    file.extractionStatus = file.text ? "extracted" : "failed";
    if (!file.text) file.extractionError = "No selectable text found.";
  } catch (error) {
    file.text = "";
    file.extractionStatus = "failed";
    file.extractionError = error.message || "PDF extraction failed.";
  }
}

async function extractDocxTextForSource(file) {
  if (!file || file.type !== "docx" || file.text) return;
  file.extractionStatus = "extracting";
  file.extractionError = "";
  try {
    const blob = await refreshRawSourceBlobFromVault(file) || file.browserFile;
    if (!blob) throw new Error("Original DOCX is not available.");
    const text = await extractDocxText(blob);
    file.text = text.trim();
    file.extractionStatus = file.text ? "extracted" : "failed";
    if (!file.text) file.extractionError = "No readable text found in DOCX.";
  } catch (error) {
    file.text = "";
    file.extractionStatus = "failed";
    file.extractionError = error.message || "DOCX extraction failed.";
  }
}

async function extractPdfText(file) {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({
    data,
    cMapPacked: true,
    cMapUrl: new URL("../node_modules/pdfjs-dist/cmaps/", import.meta.url).toString(),
    standardFontDataUrl: new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).toString(),
    wasmUrl: new URL("../node_modules/pdfjs-dist/wasm/", import.meta.url).toString()
  }).promise;
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
  const canPrepare = state.files.length > 0 && !state.pendingSave;
  const canSave = (state.pendingSave || state.hasUnsavedEdits) && state.currentFileMap;
  if (els.saveVaultBtn) {
    els.saveVaultBtn.disabled = !(canPrepare || canSave);
    els.saveVaultBtn.textContent = state.processingInbox ? "Processing..." : canSave ? "Write vault" : "Process";
  }
  if (els.bulkIngestBtn) {
    els.bulkIngestBtn.disabled = state.processingInbox || state.files.length === 0;
    els.bulkIngestBtn.textContent = state.processingInbox && !state.processingFileName ? "Ingesting..." : "Bulk ingest";
  }
  if (els.docSaveBtn) {
    els.docSaveBtn.disabled = !canSave;
    if (els.docSaveBtn.textContent !== "Saving..." && els.docSaveBtn.textContent !== "Saved") {
      els.docSaveBtn.textContent = "Save";
    }
  }
}

function sourceClass(file) {
  const classes = [];
  if (state.processingInbox && (!state.processingFileName || state.processingFileName === file.name)) classes.push("processing");
  else if (isSourceReviewReady(file)) classes.push("ready-to-write");
  return classes.join(" ");
}

function needsTextExtraction(file) {
  return (file.type === "pdf" || file.type === "docx" || file.type === "attachment") && !file.text;
}

function rawSourceAlreadySaved(file) {
  if (!file?.name) return false;
  return state.vaultFiles.some((vaultFile) => vaultFile.name === file.name);
}

function rawSourcesNeedingWrite(files) {
  return files.filter((file) => file?.dirtyRaw || file?.sourceScope !== "vault" || !rawSourceAlreadySaved(file));
}

function sourceTypeLabel(file) {
  if (file.type === "pdf") return "PDF";
  if (file.type === "docx") return "DOCX";
  const ext = basename(file.name).split(".").pop() || "TXT";
  return ext.length <= 4 ? ext.toUpperCase() : "FILE";
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
- wiki/ingest-tracker.md
- wiki/log.md
- wiki/wiki-stats.md
- wiki/_templates/source.md
- wiki/_templates/entity.md
- wiki/_templates/concept.md
- wiki/sources/sources.md
- wiki/concepts/concepts.md
- wiki/entities/entities.md
- wiki/synthesis/synthesis.md
- CLAUDE.md
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
    path === "CLAUDE.md" ||
    path.startsWith("commands/") ||
    path.startsWith("agents/") ||
    path === "operator-manual.md" ||
    path === "query-cookbook.md" ||
    path === "wiki/ingest-tracker.md" ||
    path === "wiki/log.md" ||
    path === "wiki/wiki-stats.md" ||
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
- wiki/ stores LLM-operable Markdown: source pages, concept pages, entity pages, synthesis pages, index pages, an ingest tracker, an operation log, stats, bucket overviews, and templates.
- CLAUDE.md, operator-manual.md, query-cookbook.md, commands/, agents/, and wiki/.margins/ tell future models how to operate the wiki.

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

Structural files every generated vault should include:
- CLAUDE.md: first-read agent operating skeleton.
- wiki/ingest-tracker.md: table mapping raw_sources files to generated pages.
- wiki/log.md: human-readable log with ops limited to ingest | query | compile | lint | update.
- wiki/wiki-stats.md: drift, compression, extraction, and size dashboard.
- wiki/{sources,concepts,entities,synthesis}/{bucket}.md: bucket overview pages.
- wiki/_templates/*.md: source/entity/concept/synthesis/meeting/daily shapes for future ingest.

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
  await ensureDirectory(rootHandle, "wiki/_templates");
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
  await writeTextFileIfMissing(rootHandle, "CLAUDE.md", "# CLAUDE.md\n\nMargins will write the agent operating skeleton here.\n");
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
  await readRootTextFile(rootHandle, "CLAUDE.md", fileMap);
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
  const isDocx = /\.docx$/i.test(name);
  const isReadableText = isReadableSourceTextPath(name);
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
      text = await extractDocxText(file);
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
    size: file.size,
    lastModified: file.lastModified,
    type,
    extractionStatus,
    extractionError,
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

function isReadableSourceTextPath(path) {
  return /\.(md|markdown|txt|json|jsonl|csv|tsv|py|js|jsx|ts|tsx|html|css|xml|yaml|yml|log|eml|vtt|srt)$/i.test(path);
}

async function writeRawSources(rootHandle, files) {
  if (files.length === 0) {
    await writeTextFile(rootHandle, "raw_sources/README.md", `# Raw Sources

No raw source files were loaded in the browser when this Margins folder was written.

To preserve raw evidence, reload the original files in Margins before clicking "Save." Browsers clear selected file handles after refresh for security.
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

async function deleteRawSourceFromVault(rootHandle, fileName) {
  const parts = safeRelativePath(rawSourceOutputPath(fileName)).split("/").filter(Boolean);
  const entryName = parts.pop();
  if (!entryName) return;

  let dir = rootHandle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: false });
  }
  await dir.removeEntry(entryName);
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function formatFileSize(size) {
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
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
    index: "#f4f5f7",
    source: "#9aa4b2",
    concept: "#a88cff",
    entity: "#64b5ff",
    synthesis: "#ff746d"
  }[type] || "#d8dce2";
}

function nodeRadius(type, degree = 0) {
  const base = {
    index: 13,
    source: 7.5,
    concept: 9,
    entity: 9,
    synthesis: 10.5
  }[type] || 8;
  return Math.min(18, base + Math.sqrt(Math.max(degree, 0)) * 1.25);
}

function shortLabel(label) {
  return label.length > 28 ? `${label.slice(0, 25)}...` : label;
}
