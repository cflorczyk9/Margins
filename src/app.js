import { compileVault, localDateString, vaultToFiles } from "./compiler.js";
import { clearApiSettings, loadApiSettings, maskSecret, saveApiSettings } from "./apiSettingsStore.js";
import { STORAGE_KEYS } from "./storageKeys.js";
import { state } from "./core/state.js";
import {
  RAW_SOURCE_DIR,
  LEGACY_RAW_SOURCE_DIR,
  bodyReferencesRawSource,
  createVault,
  deleteGeneratedTextFile,
  deleteRawSourceFromVault,
  directoryHandleForPath,
  ensureDirectory,
  fileHandleForPath,
  hasVaultWikiContent,
  initVaultModule,
  isDeletableGeneratedTextPath,
  isMissingEntryError,
  isRawSourceIngested,
  isRawSourcePath,
  isSourceOnlyWikiPage,
  isVaultTextPath,
  legacyRawSourceOutputPath,
  loadExistingVault,
  normalizeVaultOutputPath,
  openVault,
  pendingRawSourcesFromVault,
  prepareSourcesForProcessing,
  queryVaultPermission,
  rawSourceCandidatePaths,
  rawSourceFromFileHandle,
  rawSourceOutputPath,
  rawSourceRelativeName,
  readDirectoryTextFiles,
  readRawSourceDirectory,
  readRawSourcesFromVault,
  readRootTextFile,
  readTextHandle,
  readVaultFileMap,
  reconnectRememberedVault,
  refreshRawSourceBlobFromVault,
  requestVaultPermission,
  restoreRememberedVault,
  safeRelativePath,
  saveCurrentVault,
  savePendingRawSourcesImmediately,
  scaffoldVault,
  setActiveVault,
  sourceNoteEntryForFile,
  sourceNoteEntryForFileMap,
  updateVaultStatus,
  writeBlobFile,
  writeFileMap,
  writeRawSources,
  writeTextFile,
  writeTextFileIfMissing
} from "./core/vault.js";
import {
  apiProviderRequiresSecret,
  balancedJsonSubstring,
  dedupeQuestions,
  defaultApiGuardSettings,
  defaultEndpointForProvider,
  defaultModelForProvider,
  emptyApiUsage,
  formatControlNumber,
  hasUnclosedJsonStructure,
  isGeminiOutputTruncated,
  isModelJsonParseError,
  isModelOutputTruncatedError,
  isRateLimitError,
  isSpendGuardError,
  jsonParseCandidates,
  loadApiGuardSettings,
  looksLikeTruncatedJson,
  modelJsonParseError,
  modelOutputTruncatedError,
  modelQuestionsOrFallback,
  nonNegativeNumber,
  normalizeApiGuardSettings,
  parseDotEnv,
  parseJsonCandidate,
  parseJsonObject,
  parseLlmFiles,
  positiveInteger,
  positiveNumber,
  providerLabel,
  providerValue,
  retryAfterText,
  reviewModeLabel,
  reviewQuestion,
  stripJsonCodeFence
} from "./core/api.js";
import {
  arrayFromUnknown,
  basename,
  chunkLongSummary,
  bodyWithoutFrontmatter,
  cleanBucket,
  cleanDisplaySummary,
  cleanExtractedSourceText,
  cleanSummary,
  cleanTag,
  cleanWikiLinkLabel,
  cleanYamlScalar,
  clampSentence,
  confidenceValue,
  contextSnippet,
  entityPinnedBody,
  escapeRegExp,
  extractInlineTags,
  extractSourceSummary,
  extractWikiLinks,
  financialAccountLine,
  financialHoldingLine,
  financialTransactionLine,
  firstMatch,
  formatConnectionLine,
  formatFilingJudgmentMarkdown,
  formatFinancialDetailsMarkdown,
  frontmatterFields,
  frontmatterList,
  graphTypeFromPath,
  hasFilingPlan,
  hasFinancialDetails,
  hasYamlFrontmatter,
  insertFrontmatterLine,
  isBucketOverviewPath,
  isContextWikiPagePath,
  isFolderIndexPath,
  isGenericChecklistLink,
  isPinnedFrontmatterValue,
  isPromotedWikiPagePath,
  isReadableSourceTextPath,
  isSourceNodePagePath,
  isWikiPagePath,
  GENERIC_CHECKLIST_LINKS,
  localReadableSourceText,
  markdownTitle,
  normalizeEntityTag,
  normalizeFilingPath,
  normalizeMarginsPath,
  normalizePrimaryTypeValue,
  removePinnedFrontmatterSignals,
  relevanceValue,
  replaceSourceHeading,
  replaceSummarySection,
  replaceYamlSummary,
  setEntityPrimaryTypeBody,
  setFrontmatterScalarField,
  setPinnedFrontmatterField,
  slugifyLoose,
  sourcePathForBucket,
  sourceSlugForFile,
  sourceTagsFromFilingPlan,
  splitSummaryForCard,
  stringListFromUnknown,
  stripTrailingEllipsis,
  summaryFallbackParts,
  summaryLabelSections,
  summarySentences,
  summaryTextValue,
  tagListFromUnknown,
  titleFromSlug,
  uniqueBy,
  uniqueEntityTags,
  upsertConnectionsSection,
  upsertFilingJudgmentSection,
  upsertFinancialDetailsSection,
  upsertFrontmatterList,
  upsertFrontmatterScalar,
  warningLabel,
  wikiContextRecord,
  wikiContextRecords,
  WIKI_SOURCE_BUCKETS,
  yamlInlineScalar,
  yamlScalar
} from "./core/wiki.js";
import {
  clamp,
  escapeHtml,
  excerptForQuestion,
  field,
  firstDefined,
  firstLine,
  formatByteSize,
  formatFileSize,
  formatProcessDuration,
  formatStatNumber,
  formatUsd,
  hashString,
  normalizedFieldName,
  parseJsonLine,
  pluralize,
  textSizeBytes,
  wordCount
} from "./core/utils.js";
import {
  drawGraph,
  graphFromFileMap,
  graphView,
  initGraphView,
  openSelectedGraphNode,
  resetGraphCamera,
  selectGraphNode,
  setupGraphInteractions,
  startGraphSimulation,
  stopGraphSimulation,
  updateGraphSelection
} from "./views/graph.js";
import {
  initWikiView,
  isOperatingBrowserPath,
  renderVaultTree,
  renderWikiFiles,
  selectVaultPath
} from "./views/wiki.js";
import {
  applyFilingPlanToSourceBody,
  formatSourceTimestamp,
  ingestAnswerKey,
  needsTextExtraction,
  renderSourceTimestamp,
  requiresModelReview,
  sourceDateFromPath,
  sourceTimestampDate
} from "./views/inbox.js";
import {
  acceptLlmFiles,
  buildLlmIngestPrompt,
  buildLlmRepairPrompt,
  buildReviewResponsePrompt,
  copyLlmIngestPrompt,
  copyLlmRepairPrompt,
  copyReviewResponsePrompt,
  initLlmView,
  serializeLlmFiles,
  serializeReviewQuestions,
  serializeVaultContext,
  truncateForPrompt,
  wikiSchemaPack
} from "./views/llm.js";
import {
  CANONICAL_ENTITY_TYPES,
  ENTITY_RECENT_PAGE_SIZE,
  entityHasPinnedSignal,
  entityRecord,
  entityRecordsFromFileMap,
  isEntityPagePath
} from "./core/entities.js";
import {
  DREAM_LOG_PATH,
  DREAM_MODES,
  DREAM_PLACEHOLDER_LINKS,
  DREAM_STAGES,
  dreamBrokenLinkKey,
  dreamBrokenLinks,
  dreamChangedFilesFromRun,
  dreamCleanupEstimateMs,
  dreamGraphStats,
  dreamPageType,
  dreamRepairItems,
  dreamStageMetric,
  dreamStageName,
  dreamUnmatchedLinkEntries,
  formatDreamRunDuration,
  isDreamBrokenLinkScanPath,
  isDreamPlaceholderLink,
  wikiLinkTargetForPath
} from "./core/dream-stats.js";
import {
  activeEntityFileMap,
  handleEntityBrowserActionClick,
  handleEntityBrowserKeydown,
  handleEntityFilterClick,
  initEntitiesView,
  renderEntities,
  resetEntityRecentLimit
} from "./views/entities.js";
import {
  apiSummaryBullets,
  apiSummaryParts,
  cleanAccountLast4,
  cleanFilingStep,
  cleanFinancialValue,
  closestFinancialLabel,
  emptyFilingPlan,
  emptyFinancialDetails,
  financialDetailsPayload,
  financialFigureFromString,
  financialLabelFromContext,
  financialTransactionFromString,
  hasReviewPayloadSignal,
  isCandidateFileObject,
  isConnectionObject,
  isDiscoveryObject,
  isFilingStepObject,
  isFinancialAccountObject,
  isFinancialFigureObject,
  isFinancialHoldingObject,
  isFinancialTransactionObject,
  isLightTouchObject,
  isPropagationObject,
  isQuestionObject,
  isTakeawayObject,
  labelBeforeValue,
  MONEY_PATTERN,
  normalizeReviewPayload,
  optionListFromUnknown,
  parseCandidateFiles,
  parseConnections,
  parseDiscoveries,
  parseFilingPlacement,
  parseFilingPlan,
  parseFilingSteps,
  parseFinancialAccounts,
  parseFinancialCaveats,
  parseFinancialDetails,
  parseFinancialFigures,
  parseFinancialHoldings,
  parseFinancialTransactions,
  parseLightTouch,
  parseMissionFrame,
  parsePromotion,
  parsePropagation,
  parseReviewQuestions,
  parseTakeaways,
  questionBudgetForMode,
  reviewItemsFromUnknown,
  takeawayItemsFromUnknown,
  titleCaseLabel,
  transactionTypeFromText
} from "./core/review-parser.js";
import * as pdfjsLib from "../node_modules/pdfjs-dist/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "../node_modules/pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

const initialTheme = localStorage.getItem(STORAGE_KEYS.theme) || "light";
document.documentElement.dataset.theme = initialTheme;
let apiSecretHydrationPromise = null;
const API_REQUEST_TIMEOUT_MS = 60_000;
const ACTIVITY_RECENT_PAGE_SIZE = 12;
const PENDING_SOURCE_PAGE_SIZE = 6;
// DREAM_LOG_PATH, DREAM_MODES, DREAM_STAGES → core/dream-stats.js
// RAW_SOURCE_DIR, LEGACY_RAW_SOURCE_DIR → core/vault.js
const INGEST_PROGRESS_STEP_DELAYS_MS = [0, 1400, 4400, 12000];
const INGEST_REVIEW_OUTPUT_TOKEN_FLOOR = 16384;
const INGEST_REVIEW_RETRY_OUTPUT_TOKEN_FLOOR = 32768;
const DREAM_HELPER_OUTPUT_TOKEN_FLOOR = 12288;
const DREAM_HELPER_RETRY_OUTPUT_TOKEN_FLOOR = 12288;
const DREAM_BROKEN_LINK_DEFAULT_MAX_LINKS = 10;
const DREAM_BROKEN_LINK_DEFAULT_MAX_FILES = 4;
const DREAM_BROKEN_LINK_FULL_FILE_CHAR_LIMIT = 7000;
const DREAM_BROKEN_LINK_SNIPPET_RADIUS = 700;
const DREAM_BROKEN_LINK_SNIPPETS_PER_FILE = 4;
const DREAM_AUTO_LINK_SCORE = 82;
// DREAM_PLACEHOLDER_LINKS → core/dream-stats.js
let apiRequestTimeoutMs = API_REQUEST_TIMEOUT_MS;
let ingestProgressStepDelaysMs = INGEST_PROGRESS_STEP_DELAYS_MS;
let activeOperation = "";
let dreamRunTickerId = 0;
const ingestProgressTimers = new Map();

// Hydrate the singleton state imported from core/state.js. Runs at
// module-load time, before any event handlers fire. Function refs
// (loadApiGuardSettings, emptyApiUsage, loadModelTimingLog,
// loadProcessTimingLog) are hoisted, so initialization order matches
// the original inline definition.
Object.assign(state, {
  files: [],
  editedRawFiles: new Map(),
  vaultFiles: [],
  vault: null,
  selectedPath: null,
  selectedKind: "",
  currentFileMap: null,
  loadedFileMap: new Map(),
  theme: initialTheme,
  reviewMode: localStorage.getItem(STORAGE_KEYS.reviewMode) || "suggested",
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
  apiSecret: localStorage.getItem(STORAGE_KEYS.apiSecret) || "",
  apiGuardSettings: loadApiGuardSettings(),
  apiUsage: emptyApiUsage(),
  apiQuestionSource: "",
  ingestReviews: new Map(),
  ingestAnswers: new Map(),
  ingestErrors: new Map(),
  ingestProgress: new Map(),
  modelTimings: loadModelTimingLog(),
  processTimings: loadProcessTimingLog(),
  activeProcessTimings: new Map(),
  expandedReceiptLinks: new Set(),
  expandedSummaries: new Set(),
  revealedReceipts: new Set(),
  entityQuery: "",
  entityFilterKind: "all",
  entityFilterValue: "",
  entityFileMap: null,
  entityTypePickerPath: "",
  entityTypeOptions: [],
  entityRecentVisibleCount: ENTITY_RECENT_PAGE_SIZE,
  entityRecentSourceKey: "",
  activityRecentVisibleCount: ACTIVITY_RECENT_PAGE_SIZE,
  activityRecentSourceKey: "",
  pendingSourceVisibleCount: PENDING_SOURCE_PAGE_SIZE,
  pendingSourceKey: "",
  dreamMode: "hybrid",
  dreamReviewActive: false,
  dreamSkippedItems: new Set(),
  dreamDismissedBrokenLinks: new Set(),
  dreamPreparedRun: null,
  dreamLastRun: null,
  dreamActiveStage: ""
});

const apiThrottle = {
  queue: Promise.resolve(),
  lastStartedAt: 0,
  startedAt: []
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
  pendingCountLabel: document.getElementById("pending-count-label"),
  sourceList: document.getElementById("source-list"),
  recentActivityPanel: document.getElementById("recent-activity-panel"),
  recentActivityList: document.getElementById("recent-activity-list"),
  dreamStateCard: document.getElementById("dream-state-card"),
  dreamMeta: document.getElementById("dream-meta"),
  dreamStateTitle: document.getElementById("dream-state-title"),
  dreamStateBody: document.getElementById("dream-state-body"),
  dreamRunBtn: document.getElementById("dream-run-btn"),
  dreamReviewBtn: document.getElementById("dream-review-btn"),
  dreamModeToggle: document.getElementById("dream-mode-toggle"),
  dreamModeHelp: document.getElementById("dream-mode-help"),
  dreamPassStatus: document.getElementById("dream-pass-status"),
  dreamOperationList: document.getElementById("dream-operation-list"),
  dreamProposalList: document.getElementById("dream-proposal-list"),
  dreamRunPanel: document.getElementById("dream-run-panel"),
  dreamRunTitle: document.getElementById("dream-run-title"),
  dreamRunSummary: document.getElementById("dream-run-summary"),
  dreamRunScope: document.getElementById("dream-run-scope"),
  dreamLimitItemsLabel: document.getElementById("dream-limit-items-label"),
  dreamLimitFilesLabel: document.getElementById("dream-limit-files-label"),
  dreamLimitItems: document.getElementById("dream-limit-items"),
  dreamLimitFiles: document.getElementById("dream-limit-files"),
  dreamLimitUsd: document.getElementById("dream-limit-usd"),
  dreamRunEstimate: document.getElementById("dream-run-estimate"),
  dreamRunPreparedBtn: document.getElementById("dream-run-prepared-btn"),
  dreamRunCancelBtn: document.getElementById("dream-run-cancel-btn"),
  dreamRunCancelSecondaryBtn: document.getElementById("dream-run-cancel-secondary-btn"),
  dreamQueueKicker: document.getElementById("dream-queue-kicker"),
  dreamQueueTitle: document.getElementById("dream-queue-title"),
  dreamLogMeta: document.getElementById("dream-log-meta"),
  dreamLogEntries: document.getElementById("dream-log-entries"),
  entityMeta: document.getElementById("entity-meta"),
  entityControls: document.getElementById("entity-controls"),
  entitySearch: document.getElementById("entity-search"),
  entityTypeFilters: document.getElementById("entity-type-filters"),
  entityTagFilters: document.getElementById("entity-tag-filters"),
  entityBrowser: document.getElementById("entity-browser"),
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

// Wire the graph view module with the DOM cache and the navigation
// callback. Hoisted function declarations (activateTab, selectVaultPath)
// are visible here even though their definitions appear later in the
// module body.
initGraphView({
  els,
  onOpenNode: (path) => {
    activateTab("wiki");
    selectVaultPath(path);
  }
});

initWikiView({
  els,
  callbacks: {
    renderRecentActivity,
    renderDream,
    renderEntities,
    activeActivityFileMap,
    ingestionStats,
    setDocumentHeader,
    setDocBody,
    updateSaveButtonState,
    pathKind,
    rawFileForPath,
    rawSourceOutputPath,
    allSourceFiles
  }
});

initLlmView({
  els,
  callbacks: {
    activateTab,
    renderLlmReview,
    renderChangePreview,
    renderWikiFiles,
    renderOperatingLayer,
    renderAcceptedLlmEditState,
    drawGraph,
    graphFromFileMap,
    updateWorkflowState,
    updateSaveButtonState,
    updateReviewResponseState,
    withBusyOperation,
    mergeFileMaps,
    validateLlmFiles
  }
});

initEntitiesView({
  els,
  callbacks: {
    selectVaultPath,
    activateTab,
    renderWikiFiles,
    drawGraph,
    graphFromFileMap,
    requestVaultPermission,
    writeTextFile,
    updateVaultStatus,
    setDocumentHeader,
    setDocBody,
    updateSaveButtonState,
    withBusyOperation
  }
});

// Wire the vault module (file-system access + lifecycle). Picker and
// permission round-trips MUST run synchronously inside click handlers,
// so createVault/openVault are bound directly without busy-op wrappers
// before the picker fires.
initVaultModule({
  els,
  callbacks: {
    renderSources,
    renderVaultTree,
    renderChangePreview,
    renderWikiFiles,
    renderOperatingLayer,
    renderAcceptedLlmEditState,
    drawGraph,
    graphFromFileMap,
    updateActionState,
    updateSaveButtonState,
    updateWorkflowState,
    activateTab,
    runVaultOperation
  },
  helpers: {
    allSourceFiles,
    mergeSourceFiles,
    rawSourceAlreadySaved,
    rawSourcesNeedingWrite,
    buildReviewDecisionLog,
    extractDocxText,
    extractDocxTextForSource,
    extractPdfTextForSource,
    isActivitySourcePagePath
  }
});

els.themeToggle.checked = state.theme === "dark";
updateThemeToggleLabel();
hydrateApiControls();
hydrateApiGuardControls();
ensureApiSecretReady();
els.folderInput.addEventListener("change", handleSourceSelection);
els.fileInput.addEventListener("change", handleSourceSelection);
els.sourceList?.addEventListener("click", handleSourceActionClick);
els.recentActivityList?.addEventListener("click", handleRecentActivityClick);
els.recentActivityList?.addEventListener("keydown", handleRecentActivityKeydown);
els.dreamProposalList?.addEventListener("click", handleDreamActionClick);
els.dreamRunBtn?.addEventListener("click", () => withBusyOperation("maintenance pass", runDreamMaintenance));
els.dreamReviewBtn?.addEventListener("click", startDreamStepReview);
els.dreamModeToggle?.addEventListener("change", handleDreamModeChange);
els.dreamRunPreparedBtn?.addEventListener("click", () => withBusyOperation("dream helper", runPreparedDreamHelper));
els.dreamRunCancelBtn?.addEventListener("click", clearDreamPreparedRun);
els.dreamRunCancelSecondaryBtn?.addEventListener("click", clearDreamPreparedRun);
els.dreamLimitItems?.addEventListener("input", handleDreamRunLimitChange);
els.dreamLimitFiles?.addEventListener("input", handleDreamRunLimitChange);
els.dreamLimitUsd?.addEventListener("input", handleDreamRunLimitChange);
els.dreamRunScope?.addEventListener("click", handleDreamRunScopeClick);
els.bulkIngestBtn?.addEventListener("click", () => withBusyOperation("bulk process", bulkIngestPendingSources));
els.docBody?.addEventListener("input", handleVaultDocumentEdit);
els.docBody?.addEventListener("scroll", syncDocHighlightScroll);
els.docSaveBtn?.addEventListener("click", () => withBusyOperation("vault save", saveCurrentVault));
els.reviewMode.value = state.reviewMode;
updateReviewModeHelp();
updateWorkflowState();
renderSources();
renderVaultTree();
renderDocHighlight();
restoreRememberedVault();
installTestHooks();

els.themeToggle.addEventListener("change", () => {
  state.theme = els.themeToggle.checked ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
  localStorage.setItem(STORAGE_KEYS.theme, state.theme);
  updateThemeToggleLabel();
});

globalThis.__marginsRunAnswer = setIngestReviewAnswer;

els.workflowBtn.addEventListener("click", handleWorkflowButtonClick);
els.vaultSearch?.addEventListener("input", () => {
  renderVaultTree();
  if (state.currentFileMap) renderWikiFiles(state.currentFileMap);
});
els.entitySearch?.addEventListener("input", () => {
  state.entityQuery = els.entitySearch.value;
  resetEntityRecentLimit();
  renderEntities(activeEntityFileMap());
});
els.entityTypeFilters?.addEventListener("click", handleEntityFilterClick);
els.entityTagFilters?.addEventListener("click", handleEntityFilterClick);
els.entityBrowser?.addEventListener("click", handleEntityBrowserActionClick);
els.entityBrowser?.addEventListener("keydown", handleEntityBrowserKeydown);
document.addEventListener("keydown", (event) => {
  const activeEntities = document.getElementById("entities-view")?.classList.contains("active");
  if (!activeEntities || !els.entitySearch || els.entityControls?.hidden) return;
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f") return;
  event.preventDefault();
  els.entitySearch.focus();
  els.entitySearch.select();
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
  await withBusyOperation("source import", () => setSourceFiles([...event.dataTransfer.files]));
});

async function handleSourceSelection(event) {
  await withBusyOperation("source import", () => setSourceFiles([...event.target.files]));
}

async function withBusyOperation(label, run) {
  if (activeOperation) {
    els.stats.textContent = `${activeOperation} is still running.`;
    updateWorkflowState();
    return null;
  }

  activeOperation = label;
  updateActionState();
  try {
    return await run();
  } finally {
    activeOperation = "";
    updateActionState();
  }
}

function isBusyOperation() {
  return Boolean(activeOperation);
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
    localStorage.setItem(STORAGE_KEYS.apiSecret, apiKey);
    els.apiKey.value = "";
  }
  renderApiStatus("API key saved locally for this browser.");
}

function clearApiControls() {
  clearApiSettings();
  localStorage.removeItem(STORAGE_KEYS.apiSecret);
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
  localStorage.setItem(STORAGE_KEYS.apiGuard, JSON.stringify(state.apiGuardSettings));
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
    ? `${usage.requests}/${settings.maxRequests} attempts · ${formatStatNumber(usage.totalTokens)}/${formatStatNumber(settings.maxSessionTokens)} tokens · ${formatUsd(usage.estimatedUsd)}/${formatUsd(settings.maxSessionUsd)} estimated · ${formatControlNumber(settings.minRequestDelaySeconds)}s gap · ${settings.maxRequestsPerWindow}/${formatControlNumber(settings.requestWindowSeconds)}s cap · ${priceLabel}.`
    : "Spend guard is off.";
  els.apiGuardStatus.textContent = message ? `${message} ${body}` : body;
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
  state.revealedReceipts = new Set();
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
  await persistImportedRawSources(incomingFiles);
  if (state.files.some((file) => file.type === "pdf" && file.extractionStatus !== "extracted")) {
    await extractPdfSources();
  }
}

async function persistImportedRawSources(files) {
  const targets = files.filter((file) => file?.name);
  if (!targets.length) return 0;

  const vault = state.vaultHandle || await activeVaultForRawImport();
  if (!vault) {
    els.stats.textContent = "Documents are loaded for this session. Choose or reconnect a vault to preserve originals in raw/.";
    updateWorkflowState();
    return 0;
  }

  try {
    const written = await savePendingRawSourcesImmediately(targets);
    for (const file of targets) {
      file.sourceScope = "vault";
    }
    renderSources();
    renderVaultTree(state.currentFileMap);
    updateWorkflowState();
    els.stats.textContent = written
      ? `${written} source file${written === 1 ? "" : "s"} saved to raw/.`
      : "Source files already exist in raw/.";
    return written;
  } catch (error) {
    els.stats.textContent = `Source file save failed: ${error.message || "unknown error"}`;
    updateWorkflowState();
    return 0;
  }
}

async function activeVaultForRawImport() {
  if (state.vaultHandle) return state.vaultHandle;
  if (state.rememberedVaultHandle && await reconnectRememberedVault()) {
    return state.vaultHandle;
  }
  return null;
}

els.extractBtn.addEventListener("click", () => withBusyOperation("PDF extraction", extractPdfSources));

els.compileBtn.addEventListener("click", async () => {
  await withBusyOperation("local compile", async () => {
    state.vault = compileVault(state.files, { name: "Karpathy Original" });
    state.selectedPath = null;
    state.currentFileMap = null;
    state.hasSavedCurrent = false;
    state.pendingSave = true;
    renderVault();
    await prepareReviewForCurrentFileMap("Local compile ready. Review the filing questions, then save to your vault.");
    updateWorkflowState();
  });
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
els.saveVaultBtn.addEventListener("click", () => withBusyOperation("vault write", handleSaveAndOrganize));

els.copyBtn.addEventListener("click", async () => {
  if (!state.vault) return;
  await navigator.clipboard.writeText(state.vault.operatingLayer.operatorManual);
  els.copyBtn.textContent = "Copied";
  setTimeout(() => { els.copyBtn.textContent = "Copy operator manual"; }, 1100);
});

async function runVaultOperation(label, run) {
  if (activeOperation) return run();
  return withBusyOperation(label, run);
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
  state.entityFileMap = null;
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
  const pendingAction = event.target.closest("[data-pending-list-action]");
  if (pendingAction && els.sourceList?.contains(pendingAction)) {
    event.preventDefault();
    event.stopPropagation();
    const totalCount = Math.max(0, Number(pendingAction.dataset.pendingSourceTotal) || state.files.length);
    if (pendingAction.dataset.pendingListAction === "show-more") {
      state.pendingSourceVisibleCount = Math.min(
        totalCount,
        Math.max(PENDING_SOURCE_PAGE_SIZE, state.pendingSourceVisibleCount) + PENDING_SOURCE_PAGE_SIZE
      );
    } else if (pendingAction.dataset.pendingListAction === "show-all") {
      state.pendingSourceVisibleCount = totalCount;
    }
    renderSources();
    return;
  }

  const deleteButton = event.target.closest("[data-source-delete]");
  if (deleteButton) {
    event.stopPropagation();
    await withBusyOperation("source removal", () => removePendingSource(deleteButton.dataset.sourceDelete));
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

  const receiptLinksToggle = event.target.closest("[data-receipt-links-toggle]");
  if (receiptLinksToggle) {
    event.preventDefault();
    event.stopPropagation();
    toggleReceiptLinkedEntities(receiptLinksToggle.dataset.receiptLinksToggle);
    return;
  }

  const pathButton = event.target.closest("[data-source-open-path]");
  if (pathButton) {
    event.stopPropagation();
    openActivityPath(pathButton.dataset.sourceOpenPath);
    return;
  }

  const button = event.target.closest("[data-source-action]");
  if (!button || state.processingInbox) return;
  await withBusyOperation("source processing", () => processPendingSource(button.dataset.sourceFile));
}

async function removePendingSource(fileName) {
  if (!fileName || state.processingInbox) return;
  const file = state.files.find((entry) => entry.name === fileName);
  if (!file) return;

  const rawSaved = rawSourceAlreadySaved(file);
  const message = rawSaved
    ? `Delete ${basename(fileName)} from raw/?`
    : `Remove ${basename(fileName)} from pending?`;
  if (!confirm(message)) return;

  try {
    if (rawSaved && state.vaultHandle) {
      await deleteRawSourceFromVault(state.vaultHandle, fileName);
    }
    removeSourceFromState(fileName);
    els.stats.textContent = rawSaved
      ? `Deleted ${basename(fileName)} from raw/.`
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
  state.expandedReceiptLinks.delete(fileName);
  state.revealedReceipts.delete(fileName);
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

function toggleReceiptLinkedEntities(fileName) {
  if (!fileName) return;
  if (state.expandedReceiptLinks.has(fileName)) state.expandedReceiptLinks.delete(fileName);
  else state.expandedReceiptLinks.add(fileName);
  renderSources();
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
  const targetFiles = filesForInboxProcess(fileName);
  const trackTiming = shouldTrackProcessTiming(fileName, targetFiles);
  if (trackTiming) beginProcessTimings(targetFiles, { action: fileName ? "single" : "batch", autoFile: false });
  state.processingInbox = true;
  state.processingFileName = fileName || "";
  if (fileName) state.ingestErrors.delete(fileName);
  renderSources();
  updateSaveButtonState();
  let processError = null;
  try {
    const file = fileName ? state.files.find((entry) => entry.name === fileName) : null;
    if (file && isSourceReviewReady(file)) {
      await saveCurrentVault({ afterSaveView: "inbox" });
    } else if (!fileName && state.pendingSave && state.currentFileMap) {
      await saveCurrentVault();
    } else {
      await prepareInboxSave(fileName);
    }
  } catch (error) {
    processError = error;
    throw error;
  } finally {
    state.processingInbox = false;
    state.processingFileName = "";
    clearIngestProgress();
    renderSources();
    if (trackTiming) await finishProcessTimingsAfterRender(targetFiles, { error: processError, autoFile: false });
    updateSaveButtonState();
  }
}

async function bulkIngestPendingSources() {
  if (state.processingInbox || state.files.length === 0) return;
  const targetFiles = filesForInboxProcess("");
  beginProcessTimings(targetFiles, { action: "bulk", autoFile: true });
  state.processingInbox = true;
  state.processingFileName = "";
  renderSources();
  updateSaveButtonState();
  let processError = null;
  try {
    await prepareInboxSave("", { autoFile: true });
  } catch (error) {
    processError = error;
    throw error;
  } finally {
    state.processingInbox = false;
    state.processingFileName = "";
    clearIngestProgress();
    renderSources();
    await finishProcessTimingsAfterRender(targetFiles, { error: processError, autoFile: true });
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

  startIngestProgress(targetFiles);
  renderSources();

  await savePendingRawSourcesImmediately(targetFiles);
  markProcessTimingPhase(targetFiles, "rawSavedMs");
  await prepareSourcesForProcessing(targetFiles);
  markProcessTimingPhase(targetFiles, "textReadyMs");

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
  markProcessTimingPhase(targetFiles, "draftReadyMs");
  await prepareReviewForCurrentFileMap(
    options.autoFile ? "Margins reviewed and filed the pending documents." : "Margins prepared this document. Answer any quick checks, then approve it.",
    targetFiles,
    { ...options, contextFileMap: existingFileMap }
  );
  markProcessTimingPhase(targetFiles, "reviewReadyMs");
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

function shouldTrackProcessTiming(fileName = "", targetFiles = []) {
  if (!targetFiles.length) return false;
  if (fileName) return !isSourceReviewReady(targetFiles[0]);
  return !(state.pendingSave && state.currentFileMap);
}

function startIngestProgress(files = []) {
  const now = performance.now();
  for (const file of files) {
    if (!file?.name) continue;
    clearIngestProgress([file.name]);
    state.ingestProgress.set(file.name, { startedAt: now });
    scheduleIngestProgressTicks(file.name);
  }
}

function scheduleIngestProgressTicks(fileName) {
  const progress = state.ingestProgress.get(fileName);
  if (!progress) return;
  const timers = ingestProgressStepDelaysMs.slice(1).map((delay) => {
    const remaining = Math.max(0, delay - (performance.now() - progress.startedAt));
    return setTimeout(() => {
      if (!state.processingInbox || !state.ingestProgress.has(fileName)) return;
      renderSources();
    }, remaining + 20);
  });
  ingestProgressTimers.set(fileName, timers);
}

function clearIngestProgress(fileNames = null) {
  const names = fileNames
    ? fileNames
    : [...new Set([...state.ingestProgress.keys(), ...ingestProgressTimers.keys()])];
  for (const name of names) {
    for (const timer of ingestProgressTimers.get(name) || []) clearTimeout(timer);
    ingestProgressTimers.delete(name);
    state.ingestProgress.delete(name);
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
  localStorage.setItem(STORAGE_KEYS.reviewMode, state.reviewMode);
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
  withBusyOperation("accepting model files", async () => acceptLlmFiles());
});

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
        review.modelTiming = error.modelTiming || null;
        state.apiQuestionSource = "heuristic";
      }
    }
    state.ingestErrors.delete(file.name);
    reviewMap.set(file.name, review);
    for (const question of review.questions || []) allQuestions.push(question);
    applyIngestReviewToFileMap(file, review);
  }

  state.ingestReviews = reviewMap;
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
  const summaryParts = localSourceSummaryParts(file);
  return {
    source: "local",
    status: state.apiSecret
      ? "Local fallback shown. The model review did not finish, so this is only a triage read."
      : "Local fallback shown. Add a model key for a Claude-style source review with takeaways and filing judgment.",
    summary: summaryParts.overview,
    summaryBullets: summaryParts.bullets,
    filingPlan: emptyFilingPlan(),
    filingSteps: [],
    discoveries: [],
    financialDetails: emptyFinancialDetails(),
    connections: [],
    questions: mode === "auto" ? [] : currentIngestQuestionsForFile(file, fileMap, mode)
  };
}

function ingestModelErrorMessage(error) {
  if (isModelOutputTruncatedError(error)) {
    return "Margins review was cut off before complete JSON came back. The source file is saved. Retry this file; Margins will ask for a larger response.";
  }
  if (isSpendGuardError(error)) {
    return `${error.message} The source file is saved. Raise the guard or reset usage, then retry.`;
  }
  if (isRateLimitError(error)) {
    return `Margins review is rate-limited right now. The source file is saved. ${retryAfterText(error)}Retry this file when the limit resets.`;
  }
  return `Model review did not finish: ${error.message || "unknown error"}`;
}

function localFallbackStatusForModelError(error) {
  if (isModelOutputTruncatedError(error)) {
    return "Margins review was cut off before complete JSON came back, so it is showing local checks. Retry this file to ask for a larger response.";
  }
  if (isModelJsonParseError(error)) {
    return "Margins received a malformed review, so it is showing local checks. Retry this file to ask for a fresh review.";
  }
  if (isSpendGuardError(error)) {
    return `${error.message} Local review shown. Raise the guard or reset usage if you want model-generated questions.`;
  }
  if (isRateLimitError(error)) {
    return `Margins review is rate-limited right now. Local review shown. ${retryAfterText(error)}Retry later if you want model-generated questions.`;
  }
  return `Model review failed, using local checks: ${error.message || "unknown error"}`;
}

function canSendSourceToModel(file) {
  if (!file) return false;
  if (file.text) return true;
  const provider = els.apiProvider?.value || providerValue(state.apiSettings.providerLabel) || "gemini";
  return provider === "gemini" && canAttachSourceToGemini(file);
}

function canAttachSourceToGemini(file) {
  return Boolean(file && (file.browserFile || file.rawSourceHandle || rawSourceAlreadySaved(file)) && sourceAttachmentMimeType(file));
}

function localSourceSummary(file) {
  const parts = localSourceSummaryParts(file);
  return cleanSummary([parts.overview, ...parts.bullets].filter(Boolean).join(" "));
}

function localSourceSummaryParts(file) {
  const markdownSummary = localMarkdownClipSummaryParts(file);
  if (markdownSummary) return markdownSummary;

  const clean = cleanDisplaySummary(localReadableSourceText(file.text || ""));
  if (!clean) {
    return {
      overview: "Margins saved the source file, but there is not enough readable text to summarize yet.",
      bullets: [
        "Use model review with the original file attached if this document matters.",
        "Do not rely on local fallback for scanned, image-only, or complex documents."
      ]
    };
  }
  const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
  const overview = clampSentence(sentences[0] || clean, 220);
  const bullets = sentences
    .slice(1, 6)
    .map((sentence) => clampSentence(sentence, 180))
    .filter(Boolean);
  return { overview, bullets };
}

function localMarkdownClipSummaryParts(file) {
  const raw = String(file?.text || "");
  const { fields, body, hasFrontmatter } = looseFrontmatterFields(raw);
  if (!hasFrontmatter) return null;

  const title = cleanSummary(fields.title || markdownTitle(body) || "");
  const description = cleanSummary(fields.description || fields.summary || "");
  const cleanBody = cleanSummary(localReadableSourceText(body));
  const bodySentences = cleanBody.match(/[^.!?]+[.!?]+/g) || (cleanBody ? [cleanBody] : []);
  const overview = clampSentence(title || description || bodySentences[0] || "", 220);
  const bullets = [
    title && description ? clampSentence(description, 220) : "",
    ...bodySentences
      .filter((sentence) => cleanSummary(sentence) !== overview && cleanSummary(sentence) !== description)
      .slice(0, 4)
      .map((sentence) => clampSentence(sentence, 180))
  ].filter(Boolean);

  return overview || bullets.length ? { overview, bullets } : null;
}

function looseFrontmatterFields(text) {
  const source = String(text || "").replace(/\r\n?/g, "\n").trimStart();
  let block = "";
  let body = source;
  let hasFrontmatter = false;
  const fenced = source.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)([\s\S]*)$/);
  if (fenced) {
    block = fenced[1];
    body = fenced[2] || "";
    hasFrontmatter = true;
  } else if (/^(title|description|summary|source|url|author|published|created|tags):\s*/i.test(source)) {
    const end = source.search(/\n---\s*(?:\n|$)/);
    if (end > 0) {
      block = source.slice(0, end);
      body = source.slice(end).replace(/^\n---\s*(?:\n|$)/, "");
      hasFrontmatter = true;
    }
  }
  if (!hasFrontmatter) return { fields: {}, body: source, hasFrontmatter: false };

  const fields = {};
  let currentKey = "";
  for (const line of block.split("\n")) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (field) {
      currentKey = field[1].toLowerCase();
      fields[currentKey] = cleanYamlScalar(field[2]);
      continue;
    }
    if (currentKey && line.trim() && !/^\s*-\s+/.test(line)) {
      fields[currentKey] = cleanYamlScalar(`${fields[currentKey] || ""} ${line.trim()}`);
    }
  }

  return { fields, body, hasFrontmatter: true };
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
    missionFrame: apiReview.missionFrame || localReview.missionFrame || null,
    takeaways: apiReview.takeaways?.length ? apiReview.takeaways : localReview.takeaways || [],
    lightTouch: apiReview.lightTouch?.length ? apiReview.lightTouch : localReview.lightTouch || [],
    propagation: apiReview.propagation?.length ? apiReview.propagation : localReview.propagation || [],
    filingPlan: hasFilingPlan(apiReview.filingPlan) ? apiReview.filingPlan : localReview.filingPlan || emptyFilingPlan(),
    filingSteps: apiReview.filingSteps?.length ? apiReview.filingSteps : localReview.filingSteps || [],
    discoveries: apiReview.discoveries?.length ? apiReview.discoveries : localReview.discoveries || [],
    financialDetails: hasFinancialDetails(apiReview.financialDetails) ? apiReview.financialDetails : localReview.financialDetails || emptyFinancialDetails(),
    summary: apiReview.summary || localReview.summary,
    summaryBullets: apiReview.summaryBullets?.length ? apiReview.summaryBullets : localReview.summaryBullets || [],
    connections: apiReview.connections?.length ? apiReview.connections : localReview.connections,
    questions,
    modelReturnedNoQuestions: Boolean(apiReview.modelReturnedNoQuestions),
    modelSummaryFallback: Boolean(apiReview.modelSummaryFallback),
    modelTiming: apiReview.modelTiming || localReview.modelTiming || null,
    fallbackQuestions: apiReview.fallbackQuestions || []
  };
}

function applyIngestReviewToFileMap(file, review) {
  if (!state.currentFileMap || !review) return;
  const entry = sourceNoteEntryForFile(file);
  if (!entry) return;

  let body = entry.body;
  body = applyFilingPlanToSourceBody(body, review.filingPlan);
  if (review.summary) {
    body = replaceYamlSummary(body, review.summary);
    body = replaceSummarySection(body, review.summary);
  }
  if (review.connections?.length) {
    body = upsertConnectionsSection(body, review.connections);
  }
  if (hasFinancialDetails(review.financialDetails)) {
    body = upsertFinancialDetailsSection(body, review.financialDetails);
  }
  const targetPath = sourceTargetPathFromReview(entry.path, review);
  if (targetPath !== entry.path && !state.currentFileMap.has(targetPath)) {
    state.currentFileMap.delete(entry.path);
  }
  state.currentFileMap.set(targetPath, body);
}

function sourceTargetPathFromReview(currentPath, review) {
  const target = normalizeFilingPath(review?.filingPlan?.placement?.path || "", review?.filingPlan?.placement?.bucket || "sources");
  if (!target || target === currentPath) return currentPath;
  if (state.currentFileMap?.has(target) && target !== currentPath) return currentPath;
  return target;
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
  const headers = {
    "Content-Type": "application/json"
  };
  if (state.apiSecret) headers.Authorization = `Bearer ${state.apiSecret}`;
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers,
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
  const timing = {
    purpose: "ingest_review",
    fileName: file.name,
    ...modelTimingSourceMetadata(file, fileMap)
  };
  let content = "";
  let retriedAfterTruncation = false;
  let retryGeminiIngestReview = null;

  if (provider === "gemini") {
    const sourceParts = await geminiSourceParts(file);
    const schema = geminiIngestReviewResponseSchema();
    retryGeminiIngestReview = (isRetry) => generateGeminiJsonContent(model, prompt, sourceParts, timing, {
      responseSchema: schema,
      outputTokenLimit: ingestReviewOutputTokenLimit(isRetry)
    });
    try {
      content = await retryGeminiIngestReview(false);
    } catch (error) {
      if (!isModelOutputTruncatedError(error)) throw error;
      retriedAfterTruncation = true;
      content = await retryGeminiIngestReview(true);
    }
  } else if (provider === "openai" || provider === "local") {
    content = await generateOpenAiCompatibleJsonContent(provider, model, prompt, timing);
  } else {
    throw new Error("Direct browser calls are wired for Gemini and OpenAI-compatible endpoints right now.");
  }

  try {
    const review = parseApiIngestReview(content, file, mode, provider);
    review.modelTiming = publicModelTiming(timing.record);
    return review;
  } catch (error) {
    if (provider === "gemini" && retryGeminiIngestReview && isModelOutputTruncatedError(error) && !retriedAfterTruncation) {
      markModelTimingParseFailure(timing.record, error);
      retriedAfterTruncation = true;
      content = await retryGeminiIngestReview(true);
      try {
        const review = parseApiIngestReview(content, file, mode, provider);
        review.modelTiming = publicModelTiming(timing.record);
        return review;
      } catch (retryError) {
        markModelTimingParseFailure(timing.record, retryError);
        retryError.modelTiming = publicModelTiming(timing.record);
        throw retryError;
      }
    }
    markModelTimingParseFailure(timing.record, error);
    error.modelTiming = publicModelTiming(timing.record);
    throw error;
  }
}

async function generateOpenAiCompatibleJsonContent(provider, model, prompt, tracking = {}) {
  const endpoint = defaultEndpointForProvider(provider);
  const budget = reserveApiBudget({
    provider,
    model,
    prompt,
    extraParts: [],
    outputTokenLimit: apiOutputTokenLimit()
  });
  const timing = beginModelTiming({
    ...tracking,
    provider,
    model,
    endpoint,
    promptChars: prompt.length,
    attachmentCount: 0,
    attachmentBytes: 0,
    outputTokenLimit: budget.outputTokenLimit
  });
  tracking.record = timing;
  await waitForApiThrottle(provider);
  timing.throttleMs = elapsedSince(timing.throttleStartedAt);
  timing.requestStartedAt = performance.now();
  try {
    const headers = {
      "Content-Type": "application/json"
    };
    if (state.apiSecret) headers.Authorization = `Bearer ${state.apiSecret}`;
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers,
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
    timing.httpStatus = response.status;
    if (!response.ok) {
      const error = await apiErrorFromResponse(response, "model review");
      finishModelTiming(timing, { ok: false, error });
      throw error;
    }
    const json = await response.json();
    const usage = {
      inputTokens: json.usage?.prompt_tokens || budget.inputTokens,
      outputTokens: json.usage?.completion_tokens || budget.outputTokenLimit,
      estimated: !json.usage
    };
    recordApiUsage({ provider, model, ...usage });
    const content = json.choices?.[0]?.message?.content || "";
    finishModelTiming(timing, { ok: true, usage, contentChars: content.length });
    return content;
  } catch (error) {
    if (!timing.finishedAt) finishModelTiming(timing, { ok: false, error });
    throw error;
  }
}

async function generateApiTextContent(provider, model, prompt, tracking = {}, outputTokenFloor = 0) {
  if (provider === "gemini") {
    return generateGeminiTextContent(model, prompt, tracking, outputTokenFloor);
  }
  if (provider === "openai" || provider === "local") {
    return generateOpenAiCompatibleTextContent(provider, model, prompt, tracking, outputTokenFloor);
  }
  if (provider === "anthropic") {
    return generateAnthropicTextContent(model, prompt, tracking, outputTokenFloor);
  }
  throw new Error("Direct helper calls are wired for Gemini, OpenAI-compatible, local, and Anthropic endpoints right now.");
}

async function generateOpenAiCompatibleTextContent(provider, model, prompt, tracking = {}, outputTokenFloor = 0) {
  const endpoint = defaultEndpointForProvider(provider);
  const budget = reserveApiBudget({
    provider,
    model,
    prompt,
    extraParts: [],
    outputTokenLimit: apiOutputTokenLimit(outputTokenFloor)
  });
  const timing = beginModelTiming({
    ...tracking,
    provider,
    model,
    endpoint,
    promptChars: prompt.length,
    attachmentCount: 0,
    attachmentBytes: 0,
    outputTokenLimit: budget.outputTokenLimit
  });
  tracking.record = timing;
  await waitForApiThrottle(provider);
  timing.throttleMs = elapsedSince(timing.throttleStartedAt);
  timing.requestStartedAt = performance.now();
  try {
    const headers = {
      "Content-Type": "application/json"
    };
    if (state.apiSecret) headers.Authorization = `Bearer ${state.apiSecret}`;
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: budget.outputTokenLimit,
        messages: [
          {
            role: "system",
            content: "You are a conservative cleanup helper for a local-first Margins vault. Return margins-file blocks for proposed file changes."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });
    timing.httpStatus = response.status;
    if (!response.ok) {
      const error = await apiErrorFromResponse(response, "model helper");
      finishModelTiming(timing, { ok: false, error });
      throw error;
    }
    const json = await response.json();
    const usage = {
      inputTokens: json.usage?.prompt_tokens || budget.inputTokens,
      outputTokens: json.usage?.completion_tokens || budget.outputTokenLimit,
      estimated: !json.usage
    };
    recordApiUsage({ provider, model, ...usage });
    const content = json.choices?.[0]?.message?.content || "";
    finishModelTiming(timing, { ok: true, usage, contentChars: content.length });
    return content;
  } catch (error) {
    if (!timing.finishedAt) finishModelTiming(timing, { ok: false, error });
    throw error;
  }
}

async function generateAnthropicTextContent(model, prompt, tracking = {}, outputTokenFloor = 0) {
  const endpoint = defaultEndpointForProvider("anthropic");
  const budget = reserveApiBudget({
    provider: "anthropic",
    model,
    prompt,
    extraParts: [],
    outputTokenLimit: apiOutputTokenLimit(outputTokenFloor)
  });
  const timing = beginModelTiming({
    ...tracking,
    provider: "anthropic",
    model,
    endpoint,
    promptChars: prompt.length,
    attachmentCount: 0,
    attachmentBytes: 0,
    outputTokenLimit: budget.outputTokenLimit
  });
  tracking.record = timing;
  await waitForApiThrottle("anthropic");
  timing.throttleMs = elapsedSince(timing.throttleStartedAt);
  timing.requestStartedAt = performance.now();
  try {
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": state.apiSecret,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: budget.outputTokenLimit,
        system: "You are a conservative cleanup helper for a local-first Margins vault. Return margins-file blocks for proposed file changes.",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });
    timing.httpStatus = response.status;
    if (!response.ok) {
      const error = await apiErrorFromResponse(response, "Anthropic helper");
      finishModelTiming(timing, { ok: false, error });
      throw error;
    }
    const json = await response.json();
    const content = (json.content || [])
      .map((part) => part?.type === "text" ? part.text || "" : "")
      .filter(Boolean)
      .join("\n");
    const usage = {
      inputTokens: json.usage?.input_tokens || budget.inputTokens,
      outputTokens: json.usage?.output_tokens || budget.outputTokenLimit,
      estimated: !json.usage
    };
    recordApiUsage({ provider: "anthropic", model, ...usage });
    if (json.stop_reason === "max_tokens") {
      const error = modelOutputTruncatedError("anthropic", content, json.stop_reason);
      finishModelTiming(timing, { ok: false, usage, contentChars: content.length, error });
      throw error;
    }
    finishModelTiming(timing, { ok: true, usage, contentChars: content.length });
    return content;
  } catch (error) {
    if (!timing.finishedAt) finishModelTiming(timing, { ok: false, error });
    throw error;
  }
}

async function generateGeminiReviewQuestions(model, prompt) {
  const content = await generateGeminiJsonContent(model, `You generate concise filing review questions for a local-first personal wiki. Return JSON only.\n\n${prompt}`);
  return parseApiQuestions(content).slice(0, 3);
}

async function generateGeminiTextContent(model, prompt, tracking = {}, outputTokenFloor = 0) {
  const endpoint = defaultEndpointForProvider("gemini").replace("{model}", encodeURIComponent(normalizeGeminiModel(model)));
  const outputTokenLimit = apiOutputTokenLimit(outputTokenFloor);
  const budget = reserveApiBudget({
    provider: "gemini",
    model,
    prompt,
    extraParts: [],
    outputTokenLimit
  });
  const timing = beginModelTiming({
    ...tracking,
    provider: "gemini",
    model,
    endpoint,
    promptChars: prompt.length,
    attachmentCount: 0,
    attachmentBytes: 0,
    outputTokenLimit: budget.outputTokenLimit
  });
  tracking.record = timing;
  await waitForApiThrottle("gemini");
  timing.throttleMs = elapsedSince(timing.throttleStartedAt);
  timing.requestStartedAt = performance.now();
  try {
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": state.apiSecret
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: budget.outputTokenLimit
        }
      })
    });
    timing.httpStatus = response.status;
    if (!response.ok) {
      const error = await apiErrorFromResponse(response, "Gemini helper");
      finishModelTiming(timing, { ok: false, error });
      throw error;
    }
    const json = await response.json();
    const candidate = json.candidates?.[0] || {};
    const content = candidate.content?.parts?.map((part) => part.text || "").join("\n") || "";
    const usage = {
      inputTokens: json.usageMetadata?.promptTokenCount || budget.inputTokens,
      outputTokens: geminiOutputTokenCount(json.usageMetadata) || budget.outputTokenLimit,
      estimated: !json.usageMetadata
    };
    recordApiUsage({ provider: "gemini", model, ...usage });
    if (isGeminiOutputTruncated(candidate, content)) {
      const error = modelOutputTruncatedError("gemini", content, candidate.finishReason || "", "margins-file blocks");
      finishModelTiming(timing, { ok: false, usage, contentChars: content.length, error });
      throw error;
    }
    finishModelTiming(timing, { ok: true, usage, contentChars: content.length });
    return content;
  } catch (error) {
    if (!timing.finishedAt) finishModelTiming(timing, { ok: false, error });
    throw error;
  }
}

async function generateGeminiJsonContent(model, prompt, extraParts = [], tracking = {}, options = {}) {
  const endpoint = defaultEndpointForProvider("gemini").replace("{model}", encodeURIComponent(normalizeGeminiModel(model)));
  const outputTokenLimit = positiveInteger(options.outputTokenLimit, apiOutputTokenLimit());
  const budget = reserveApiBudget({
    provider: "gemini",
    model,
    prompt,
    extraParts,
    outputTokenLimit
  });
  const timing = beginModelTiming({
    ...tracking,
    provider: "gemini",
    model,
    endpoint,
    promptChars: prompt.length,
    attachmentCount: extraParts.length,
    attachmentBytes: geminiAttachmentBytes(extraParts),
    outputTokenLimit: budget.outputTokenLimit
  });
  tracking.record = timing;
  await waitForApiThrottle("gemini");
  timing.throttleMs = elapsedSince(timing.throttleStartedAt);
  timing.requestStartedAt = performance.now();
  try {
    const response = await fetchWithTimeout(endpoint, {
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
        responseSchema: options.responseSchema,
        maxOutputTokens: budget.outputTokenLimit
      }
      })
    });
    timing.httpStatus = response.status;
    if (!response.ok) {
      const error = await apiErrorFromResponse(response, "Gemini");
      finishModelTiming(timing, { ok: false, error });
      throw error;
    }
    const json = await response.json();
    const candidate = json.candidates?.[0] || {};
    const content = candidate.content?.parts?.map((part) => part.text || "").join("\n") || "";
    const usage = {
      inputTokens: json.usageMetadata?.promptTokenCount || budget.inputTokens,
      outputTokens: geminiOutputTokenCount(json.usageMetadata) || budget.outputTokenLimit,
      estimated: !json.usageMetadata
    };
    recordApiUsage({ provider: "gemini", model, ...usage });
    if (isGeminiOutputTruncated(candidate, content)) {
      const error = modelOutputTruncatedError("gemini", content, candidate.finishReason || "");
      finishModelTiming(timing, { ok: false, usage, contentChars: content.length, error });
      throw error;
    }
    finishModelTiming(timing, { ok: true, usage, contentChars: content.length });
    return content;
  } catch (error) {
    if (!timing.finishedAt) finishModelTiming(timing, { ok: false, error });
    throw error;
  }
}

function geminiIngestReviewResponseSchema() {
  return {
    type: "OBJECT",
    properties: {
      summary: {
        type: "OBJECT",
        properties: {
          overview: { type: "STRING" },
          bullets: { type: "ARRAY", items: { type: "STRING" } }
        },
        required: ["overview", "bullets"]
      },
      takeaways: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            label: { type: "STRING" },
            point: { type: "STRING" },
            relevance: { type: "STRING" },
            whyItMatters: { type: "STRING" }
          },
          required: ["label", "point"]
        }
      },
      connections: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            path: { type: "STRING" },
            title: { type: "STRING" },
            type: { type: "STRING" },
            relevance: { type: "STRING" },
            reason: { type: "STRING" }
          }
        }
      },
      filingPlan: {
        type: "OBJECT",
        properties: {
          whySaved: { type: "ARRAY", items: { type: "STRING" } },
          placement: {
            type: "OBJECT",
            properties: {
              bucket: { type: "STRING" },
              path: { type: "STRING" },
              title: { type: "STRING" },
              reason: { type: "STRING" },
              alternatives: { type: "ARRAY", items: { type: "STRING" } }
            }
          },
          tags: { type: "ARRAY", items: { type: "STRING" } },
          regionTag: { type: "STRING" },
          typeTag: { type: "STRING" },
          typeTagNote: { type: "STRING" },
          candidateFiles: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                path: { type: "STRING" },
                reason: { type: "STRING" },
                priority: { type: "STRING" }
              }
            }
          },
          promotion: {
            type: "OBJECT",
            properties: {
              candidate: { type: "STRING" },
              recommendation: { type: "STRING" },
              reason: { type: "STRING" }
            }
          }
        }
      },
      financialDetails: {
        type: "OBJECT",
        properties: {
          accounts: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                institution: { type: "STRING" },
                owner: { type: "STRING" },
                accountType: { type: "STRING" },
                accountName: { type: "STRING" },
                accountNumberLast4: { type: "STRING" },
                period: { type: "STRING" }
              }
            }
          },
          figures: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                label: { type: "STRING" },
                value: { type: "STRING" },
                date: { type: "STRING" },
                context: { type: "STRING" }
              }
            }
          },
          holdings: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                symbol: { type: "STRING" },
                name: { type: "STRING" },
                quantity: { type: "STRING" },
                value: { type: "STRING" },
                context: { type: "STRING" }
              }
            }
          },
          transactions: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                date: { type: "STRING" },
                description: { type: "STRING" },
                amount: { type: "STRING" },
                type: { type: "STRING" }
              }
            }
          },
          caveats: { type: "ARRAY", items: { type: "STRING" } }
        },
        required: ["accounts", "figures", "holdings", "transactions", "caveats"]
      },
      filingSteps: {
        type: "ARRAY",
        items: { type: "STRING" }
      },
      discoveries: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            kind: { type: "STRING" },
            title: { type: "STRING" },
            detail: { type: "STRING" },
            severity: { type: "STRING" }
          }
        }
      },
      asks: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            kind: { type: "STRING" },
            question: { type: "STRING" },
            whyAsk: { type: "STRING" },
            recommendation: { type: "STRING" },
            options: { type: "ARRAY", items: { type: "STRING" } }
          }
        }
      }
    },
    required: ["summary", "takeaways", "connections", "asks"]
  };
}

function beginProcessTimings(files = [], { action = "single", autoFile = false } = {}) {
  const now = performance.now();
  const startedAt = new Date().toISOString();
  const batchSize = files.length;
  for (const file of files) {
    if (!file?.name) continue;
    const record = beginProcessTimingRecord(file, {
      action,
      autoFile,
      batchSize,
      startedAt,
      startedAtMs: now
    });
    state.activeProcessTimings.set(file.name, record);
  }
}

function beginProcessTimingRecord(file, {
  action = "single",
  autoFile = false,
  batchSize = 1,
  startedAt = new Date().toISOString(),
  startedAtMs = performance.now()
} = {}) {
  return {
    id: `process-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    purpose: "ingest_process",
    fileName: file.name,
    ...modelTimingSourceMetadata(file, state.currentFileMap),
    action,
    autoFile: Boolean(autoFile),
    batchSize,
    startedAt,
    startedAtMs,
    rawSavedMs: 0,
    textReadyMs: 0,
    draftReadyMs: 0,
    reviewReadyMs: 0,
    renderReadyMs: 0,
    totalMs: 0,
    finishedAt: "",
    readyToApprove: false,
    filed: false,
    ok: false,
    error: "",
    modelProvider: "",
    modelName: "",
    modelTotalMs: 0,
    modelRoundTripMs: 0,
    modelOk: false,
    modelParseOk: true,
    modelError: ""
  };
}

function markProcessTimingPhase(files = [], fieldName = "") {
  if (!fieldName) return;
  const now = performance.now();
  for (const file of files) {
    const record = state.activeProcessTimings.get(file?.name || "");
    if (!record || record[fieldName]) continue;
    record[fieldName] = Math.max(0, Math.round(now - record.startedAtMs));
  }
}

async function finishProcessTimingsAfterRender(files = [], { error = null, autoFile = false } = {}) {
  const records = files
    .map((file) => ({ file, record: state.activeProcessTimings.get(file?.name || "") }))
    .filter((entry) => entry.record);
  if (!records.length) return;

  await nextAnimationFrame();
  for (const { file, record } of records) {
    finishProcessTiming(file, record, { error, autoFile });
    state.activeProcessTimings.delete(file.name);
  }
  saveProcessTimingLog();
  if (!autoFile && records.some(({ file }) => isSourceReviewReady(file))) renderSources();
}

function finishProcessTiming(file, record, { error = null, autoFile = false } = {}) {
  const now = performance.now();
  const review = state.ingestReviews.get(file?.name || "");
  const readyToApprove = Boolean(file && isSourceReviewReady(file));
  const filed = Boolean(autoFile && !readyToApprove && !state.ingestErrors.has(file?.name || ""));
  const processError = error || state.ingestErrors.get(file?.name || "") || null;
  const modelTiming = review?.modelTiming || null;
  Object.assign(record, modelTimingSourceMetadata(file, state.currentFileMap));

  record.finishedAt = new Date().toISOString();
  record.renderReadyMs = Math.max(0, Math.round(now - record.startedAtMs));
  record.totalMs = record.renderReadyMs;
  record.readyToApprove = readyToApprove;
  record.filed = filed;
  record.ok = Boolean(!processError && (readyToApprove || filed));
  record.error = processError ? processTimingErrorLabel(processError) : "";
  if (modelTiming) {
    record.modelProvider = modelTiming.provider || "";
    record.modelName = modelTiming.model || "";
    record.modelTotalMs = safeNumber(modelTiming.totalMs);
    record.modelRoundTripMs = safeNumber(modelTiming.roundTripMs);
    record.modelOk = Boolean(modelTiming.ok);
    record.modelParseOk = modelTiming.parseOk !== false;
    record.modelError = clampSentence(modelTiming.error || "", 180);
  }
  state.processTimings.push(record);
  trimProcessTimingLog();
  return record;
}

function publicProcessTiming(record) {
  if (!record) return null;
  return {
    purpose: record.purpose || "ingest_process",
    fileName: record.fileName,
    sourceType: record.sourceType,
    sourceScope: record.sourceScope,
    sourceMimeType: record.sourceMimeType,
    sourceSizeBytes: record.sourceSizeBytes,
    sourceTextChars: record.sourceTextChars,
    vaultContextFileCount: record.vaultContextFileCount,
    action: record.action,
    autoFile: record.autoFile,
    batchSize: record.batchSize,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt || "",
    rawSavedMs: record.rawSavedMs,
    textReadyMs: record.textReadyMs,
    draftReadyMs: record.draftReadyMs,
    reviewReadyMs: record.reviewReadyMs,
    renderReadyMs: record.renderReadyMs,
    totalMs: record.totalMs,
    readyToApprove: record.readyToApprove,
    filed: record.filed,
    ok: record.ok,
    error: record.error,
    modelProvider: record.modelProvider,
    modelName: record.modelName,
    modelTotalMs: record.modelTotalMs,
    modelRoundTripMs: record.modelRoundTripMs,
    modelOk: record.modelOk,
    modelParseOk: record.modelParseOk,
    modelError: record.modelError
  };
}

function loadProcessTimingLog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.processTimings) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeStoredProcessTiming).filter(Boolean).slice(-100) : [];
  } catch {
    return [];
  }
}

function normalizeStoredProcessTiming(record) {
  if (!record || typeof record !== "object") return null;
  return {
    id: String(record.id || `process-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    purpose: cleanSummary(record.purpose || "ingest_process"),
    fileName: cleanSummary(record.fileName || ""),
    sourceType: cleanSummary(record.sourceType || ""),
    sourceScope: cleanSummary(record.sourceScope || ""),
    sourceMimeType: cleanSummary(record.sourceMimeType || ""),
    sourceSizeBytes: safeNumber(record.sourceSizeBytes),
    sourceTextChars: safeNumber(record.sourceTextChars),
    vaultContextFileCount: safeNumber(record.vaultContextFileCount),
    action: cleanSummary(record.action || ""),
    autoFile: Boolean(record.autoFile),
    batchSize: safeNumber(record.batchSize),
    startedAt: cleanSummary(record.startedAt || ""),
    finishedAt: cleanSummary(record.finishedAt || ""),
    rawSavedMs: safeNumber(record.rawSavedMs),
    textReadyMs: safeNumber(record.textReadyMs),
    draftReadyMs: safeNumber(record.draftReadyMs),
    reviewReadyMs: safeNumber(record.reviewReadyMs),
    renderReadyMs: safeNumber(record.renderReadyMs),
    totalMs: safeNumber(record.totalMs),
    readyToApprove: Boolean(record.readyToApprove),
    filed: Boolean(record.filed),
    ok: Boolean(record.ok),
    error: clampSentence(record.error || "", 180),
    modelProvider: cleanSummary(record.modelProvider || ""),
    modelName: cleanSummary(record.modelName || ""),
    modelTotalMs: safeNumber(record.modelTotalMs),
    modelRoundTripMs: safeNumber(record.modelRoundTripMs),
    modelOk: Boolean(record.modelOk),
    modelParseOk: record.modelParseOk !== false,
    modelError: clampSentence(record.modelError || "", 180)
  };
}

function saveProcessTimingLog() {
  trimProcessTimingLog();
  try {
    localStorage.setItem(STORAGE_KEYS.processTimings, JSON.stringify(state.processTimings.map(publicProcessTiming)));
  } catch {
    // Local timing diagnostics should never block ingest or approval.
  }
}

function trimProcessTimingLog() {
  if (state.processTimings.length > 100) {
    state.processTimings.splice(0, state.processTimings.length - 100);
  }
}

function latestProcessTimingForFile(fileName) {
  if (!fileName) return null;
  for (let index = state.processTimings.length - 1; index >= 0; index -= 1) {
    const record = state.processTimings[index];
    if (record.fileName === fileName) return record;
  }
  return null;
}

function processTimingErrorLabel(error) {
  if (!error) return "";
  if (typeof error === "string") return clampSentence(error, 180);
  return clampSentence(error.message || String(error), 180);
}

function beginModelTiming({
  purpose = "model_call",
  fileName = "",
  sourceType = "",
  sourceScope = "",
  sourceMimeType = "",
  sourceSizeBytes = 0,
  sourceTextChars = 0,
  vaultContextFileCount = 0,
  provider = "",
  model = "",
  endpoint = "",
  promptChars = 0,
  attachmentCount = 0,
  attachmentBytes = 0,
  outputTokenLimit = 0
} = {}) {
  const now = performance.now();
  const record = {
    id: `model-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    purpose,
    fileName,
    sourceType,
    sourceScope,
    sourceMimeType,
    sourceSizeBytes,
    sourceTextChars,
    vaultContextFileCount,
    provider,
    model,
    endpoint: redactEndpoint(endpoint),
    promptChars,
    attachmentCount,
    attachmentBytes,
    outputTokenLimit,
    startedAt: new Date().toISOString(),
    startedAtMs: now,
    throttleStartedAt: now,
    throttleMs: 0,
    requestStartedAt: 0,
    roundTripMs: 0,
    totalMs: 0,
    httpStatus: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedTokens: false,
    contentChars: 0,
    ok: false,
    parseOk: true,
    error: ""
  };
  state.modelTimings.push(record);
  trimModelTimingLog();
  return record;
}

function finishModelTiming(record, { ok, usage = {}, contentChars = 0, error = null } = {}) {
  if (!record) return null;
  const now = performance.now();
  record.finishedAt = new Date().toISOString();
  record.roundTripMs = record.requestStartedAt ? Math.round(now - record.requestStartedAt) : 0;
  record.totalMs = Math.round(now - record.startedAtMs);
  record.ok = Boolean(ok);
  record.inputTokens = usage.inputTokens || 0;
  record.outputTokens = usage.outputTokens || 0;
  record.estimatedTokens = Boolean(usage.estimated);
  record.contentChars = contentChars || 0;
  if (error) record.error = modelTimingErrorLabel(error);
  saveModelTimingLog();
  return record;
}

function markModelTimingParseFailure(record, error) {
  if (!record) return null;
  record.parseOk = false;
  record.error = modelTimingErrorLabel(error);
  saveModelTimingLog();
  return record;
}

function publicModelTiming(record) {
  if (!record) return null;
  return {
    purpose: record.purpose,
    fileName: record.fileName,
    sourceType: record.sourceType,
    sourceScope: record.sourceScope,
    sourceMimeType: record.sourceMimeType,
    sourceSizeBytes: record.sourceSizeBytes,
    sourceTextChars: record.sourceTextChars,
    vaultContextFileCount: record.vaultContextFileCount,
    provider: record.provider,
    model: record.model,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt || "",
    promptChars: record.promptChars,
    attachmentCount: record.attachmentCount,
    attachmentBytes: record.attachmentBytes,
    outputTokenLimit: record.outputTokenLimit,
    throttleMs: record.throttleMs,
    roundTripMs: record.roundTripMs,
    totalMs: record.totalMs,
    httpStatus: record.httpStatus,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    estimatedTokens: record.estimatedTokens,
    contentChars: record.contentChars,
    ok: record.ok,
    parseOk: record.parseOk,
    error: record.error
  };
}

function modelTimingSourceMetadata(file, fileMap) {
  const browserSize = Number(file?.browserFile?.size || 0);
  const fileSize = Number(file?.size || 0);
  return {
    sourceType: file?.type || "",
    sourceScope: file?.sourceScope || "",
    sourceMimeType: sourceAttachmentMimeType(file),
    sourceSizeBytes: Number.isFinite(browserSize) && browserSize > 0 ? browserSize : Number.isFinite(fileSize) ? fileSize : 0,
    sourceTextChars: String(file?.text || "").length,
    vaultContextFileCount: fileMap?.size || 0
  };
}

function geminiAttachmentBytes(extraParts = []) {
  return extraParts.reduce((total, part) => {
    const data = part?.inline_data?.data || part?.inlineData?.data || "";
    return total + base64ByteLength(data);
  }, 0);
}

function base64ByteLength(value) {
  const clean = String(value || "").replace(/\s+/g, "");
  if (!clean) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(clean.length * 3 / 4) - padding);
}

function loadModelTimingLog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.modelTimings) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeStoredModelTiming).filter(Boolean).slice(-100) : [];
  } catch {
    return [];
  }
}

function normalizeStoredModelTiming(record) {
  if (!record || typeof record !== "object") return null;
  return {
    id: String(record.id || `model-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    purpose: cleanSummary(record.purpose || "model_call"),
    fileName: cleanSummary(record.fileName || ""),
    sourceType: cleanSummary(record.sourceType || ""),
    sourceScope: cleanSummary(record.sourceScope || ""),
    sourceMimeType: cleanSummary(record.sourceMimeType || ""),
    sourceSizeBytes: safeNumber(record.sourceSizeBytes),
    sourceTextChars: safeNumber(record.sourceTextChars),
    vaultContextFileCount: safeNumber(record.vaultContextFileCount),
    provider: cleanSummary(record.provider || ""),
    model: cleanSummary(record.model || ""),
    endpoint: redactEndpoint(record.endpoint || ""),
    promptChars: safeNumber(record.promptChars),
    attachmentCount: safeNumber(record.attachmentCount),
    attachmentBytes: safeNumber(record.attachmentBytes),
    outputTokenLimit: safeNumber(record.outputTokenLimit),
    startedAt: cleanSummary(record.startedAt || ""),
    finishedAt: cleanSummary(record.finishedAt || ""),
    throttleMs: safeNumber(record.throttleMs),
    roundTripMs: safeNumber(record.roundTripMs),
    totalMs: safeNumber(record.totalMs),
    httpStatus: safeNumber(record.httpStatus),
    inputTokens: safeNumber(record.inputTokens),
    outputTokens: safeNumber(record.outputTokens),
    estimatedTokens: Boolean(record.estimatedTokens),
    contentChars: safeNumber(record.contentChars),
    ok: Boolean(record.ok),
    parseOk: record.parseOk !== false,
    error: clampSentence(record.error || "", 180)
  };
}

function saveModelTimingLog() {
  trimModelTimingLog();
  try {
    localStorage.setItem(STORAGE_KEYS.modelTimings, JSON.stringify(state.modelTimings.map(publicModelTiming)));
  } catch {
    // Timing logs are best-effort diagnostics; never block ingest on storage quota or privacy settings.
  }
}

function trimModelTimingLog() {
  if (state.modelTimings.length > 100) {
    state.modelTimings.splice(0, state.modelTimings.length - 100);
  }
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function elapsedSince(startedAtMs) {
  return Math.max(0, Math.round(performance.now() - startedAtMs));
}

function nextAnimationFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function redactEndpoint(endpoint) {
  if (!endpoint) return "";
  try {
    const url = new URL(endpoint);
    url.search = "";
    return url.toString();
  } catch {
    return String(endpoint).replace(/\?.*$/, "");
  }
}

function modelTimingErrorLabel(error) {
  if (!error) return "";
  const status = error.status ? `HTTP ${error.status}: ` : "";
  return clampSentence(`${status}${error.message || error}`, 180);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  let timeoutError = null;
  const request = fetch(url, {
    ...options,
    signal: controller.signal
  });
  let timeoutId = 0;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      timeoutError = apiTimeoutError();
      controller.abort(timeoutError);
      reject(timeoutError);
    }, apiRequestTimeoutMs);
  });

  try {
    return await Promise.race([request, timeout]);
  } catch (error) {
    if (timeoutError) throw timeoutError;
    throw error;
  } finally {
    clearTimeout(timeoutId);
    request.catch(() => {});
  }
}

function apiTimeoutError() {
  const error = new Error(`Model request timed out after ${Math.ceil(apiRequestTimeoutMs / 1000)} seconds.`);
  error.code = "MARGINS_API_TIMEOUT";
  return error;
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

function apiOutputTokenLimit(floor = 0) {
  const configured = state.apiGuardSettings.enabled
    ? state.apiGuardSettings.maxOutputTokens
    : defaultApiGuardSettings().maxOutputTokens;
  return Math.max(positiveInteger(configured, defaultApiGuardSettings().maxOutputTokens), floor);
}

function ingestReviewOutputTokenLimit(isRetry = false) {
  return apiOutputTokenLimit(isRetry ? INGEST_REVIEW_RETRY_OUTPUT_TOKEN_FLOOR : INGEST_REVIEW_OUTPUT_TOKEN_FLOOR);
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
      reasons.push(`${projectedRequests}/${guard.maxRequests} model call attempts`);
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
  const askInstruction = mode === "auto"
    ? "Return no asks in auto mode."
    : `Return 0-${budget} specific asks. Ask when the answer changes bucket/path, type tag, promotion, propagation, sensitivity, priority, or follow-up.`;
  return `Review this uploaded source for Margins, a local-first source-to-wiki compiler. Return a filing judgment plus a compact pending-card review.

The original file is already saved in raw/. Margins will show your JSON on the pending inbox card before writing the wiki.

Contract:
- JSON only. No markdown, no prose outside JSON.
- Act like Margins deciding where this source belongs in an existing wiki. Do not just summarize.
- First decide: why the user likely saved it, what current wiki files matter, bucket/path, tags, region/type tag, links, and what should be asked before approval.
- Always fill summary.overview and summary.bullets. An asks-only response is incomplete.
- summary.overview: one direct-read source summary, <=180 chars.
- summary.bullets: 2-4 source-supported bullets, <=140 chars each.
- takeaways: 1-3 labeled concrete takeaways for display.
- filingPlan.whySaved: 1-4 bullets explaining why this source likely matters to the user's active wiki.
- filingPlan.candidateFiles: 4-8 exact current wiki context paths you would inspect before final placement, with reasons. Use only paths from Current wiki context.
- filingPlan.placement: recommended bucket, final source path, title, reason, and 1-3 alternatives when there is a real bucket call.
- filingPlan.tags: topic tags you would put in frontmatter. Include source and durable topic tags. Include regionTag separately.
- filingPlan.regionTag: use region/build, region/personal, region/school, region/career, region/briefly, or blank if not supported.
- filingPlan.typeTag: one type tag if the closed set fits; if none fits, leave blank and explain in typeTagNote.
- filingPlan.promotion: whether to create a new concept/entity/synthesis page now or wait for another source.
- connections: include only specific existing or proposed wiki pages that are useful. Prefer exact existing paths from current wiki context. Avoid generic paper section labels like display, subjects, results, methods, or experiment.
- filingSteps: 5-8 short Activity checklist lines, not a summary. Show what Margins read, detected, created, updated, linked, and flagged. Use concrete entity/source names and facts.
- discoveries: include contradictions, stale assumptions, or review-worthy conflicts only when the source directly supports them.
- financialDetails: use empty arrays unless this is a true financial/account/tax/payroll/equity/benefits/invoice/receipt document.
- Do not infer finance from isolated words like "chase", "cost", "price", "value", "account", or a standalone dollar amount in a transcript/article.
- For true financial documents, copy only visible account details, figures, holdings, and transactions. Never invent missing values.
- asks: ${askInstruction}
- Do not ask generic filing questions. Margins should recommend a path.
- Exception: do ask a specific bucket/path/type/promotion question when two reasonable placements remain after reading current wiki context.
- Do not include transcript dumps, unprocessed YAML/frontmatter, embed syntax, or generic filing questions.
- Do not apply special handling for document classes. Infer durable patterns from current wiki context, and explain any structural gap before proposing new tags or pages.
- Review mode is ${reviewModeLabel(mode)}. Question budget: ${budget}.

Return JSON in this shape:
{
  "summary": {"overview":"Required card summary.","bullets":["Required source-supported bullet."]},
  "takeaways": [{"label":"Short label","point":"Concrete takeaway.","relevance":"primary|secondary|context","whyItMatters":"Why this matters."}],
  "connections": [{"path":"wiki/...","title":"Page title","type":"existing|new","relevance":"primary|secondary|context","reason":"Why this connection matters."}],
  "filingPlan": {
    "whySaved":["Why this source likely matters to the user's current work."],
    "candidateFiles":[{"path":"wiki/...","reason":"Why this path matters before filing.","priority":"high|medium|low"}],
    "placement":{"bucket":"coding|ideas|projects|career|personal|school|sources","path":"wiki/projects/source-example.md","title":"Source title","reason":"Why this bucket/path fits.","alternatives":["wiki/ideas/source-...md"]},
    "tags":["source","topic-tag"],
    "regionTag":"region/build",
    "typeTag":"",
    "typeTagNote":"No closed-set type tag fits cleanly.",
    "promotion":{"candidate":"candidate-concept-or-entity","recommendation":"Create now or wait for more supporting context.","reason":"Why promote or wait."}
  },
  "filingSteps": ["Reading PDF — 12 pages, ~3,200 words", "Detected 6 entities · 4 already in your brain", "Created Source Title as a new source", "Updated Existing Entity · concrete source-supported change", "Linked to Existing Page and Proposed Page", "Discovered: concrete contradiction or conflict", "Prepared source page · 3 entity updates · 1 item flagged for review"],
  "discoveries": [{"kind":"Contradiction","title":"Short label","detail":"What changed or conflicts.","severity":"review"}],
  "financialDetails": {"accounts":[],"figures":[],"holdings":[],"transactions":[],"caveats":[]},
  "asks": [{"kind":"Follow-up|Identity|Priority|Sensitivity|Propagation","question":"Specific question.","whyAsk":"What answer changes.","recommendation":"My take: ...","options":["Recommended option","Alternative","Skip"]}]
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


function keywordSet(text) {
  return new Set(String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((term) => (term.length > 2 || /^[0-9][a-z]$/.test(term)) && !STOP_WORDS_FOR_CONTEXT.has(term)));
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
  const parsed = normalizeReviewPayload(parseJsonObject(content));
  if (!parsed) {
    throw modelJsonParseError(provider, content);
  }
  const missionFrame = parseMissionFrame(field(parsed, "missionFrame", "mission", "frame", "mission_frame"));
  const takeaways = parseTakeaways(field(parsed, "takeaways", "keyTakeaways", "key_takeaways", "key_points", "points", "insights"));
  const lightTouch = parseLightTouch(field(parsed, "lightTouch", "light_touch", "skipOrLightTouch", "skip_or_light_touch", "lightTouchNotes"));
  const propagation = parsePropagation(field(parsed, "propagation", "proposedPropagation", "proposed_propagation", "updates", "proposedUpdates"));
  const connections = parseConnections(field(parsed, "connections", "links", "relatedPages", "related_pages"));
  const filingPlan = parseFilingPlan(field(parsed, "filingPlan", "filing_plan", "placement", "placementPlan", "placement_plan"), file);
  const filingSteps = parseFilingSteps(field(parsed, "filingSteps", "filing_steps", "activity", "checklist", "progress", "steps"));
  const discoveries = parseDiscoveries(field(parsed, "discoveries", "discovery", "contradictions", "conflicts", "flags"));
  const financialDetails = parseFinancialDetails(financialDetailsPayload(parsed));
  const questions = parseReviewQuestions(field(parsed, "asks", "questions", "followupQuestions", "follow_up_questions", "followUps", "follow_ups"));
  const structuredSummary = {
    overview: missionFrame?.oneLine || "",
    bullets: takeaways.map((item) => item.label ? `${item.label}: ${item.point}` : item.point)
  };
  const summaryParts = apiSummaryParts(
    firstDefined(field(parsed, "summary", "sourceSummary", "source_summary", "overview"), structuredSummary),
    field(parsed, "summaryBullets", "summary_bullets", "bullets")
  );
  const localSummaryParts = localSourceSummaryParts(file);
  const modelSummaryFallback = !summaryParts.overview && summaryParts.bullets.length === 0;
  const displaySummaryParts = modelSummaryFallback ? localSummaryParts : summaryParts;
  let parsedQuestions = questions
    .map((question) => reviewQuestion(
      /careful|sensitive|risk|warning/i.test(question.kind || "") ? "warn" : "suggest",
      question.kind || "Quick check",
      rawSourceOutputPath(file.name),
      question.question || "",
      question.whyAsk || question.reason || "The model flagged this as useful before filing.",
      question.recommendation || "My take: use the default unless it looks wrong.",
      question.options?.length ? question.options.slice(0, 4) : ["Yes", "No", "Use default"]
    ))
    .filter((question) => question.question)
    .slice(0, questionBudgetForMode(mode));
  if (mode !== "auto" && parsedQuestions.length === 0) {
    parsedQuestions = filingPlanQuestions(file, filingPlan)
      .slice(0, questionBudgetForMode(mode));
  }
  const modelReturnedNoQuestions = mode !== "auto" && parsedQuestions.length === 0;
  return {
    source: "api",
    provider,
    reviewedAt: new Date().toISOString(),
    status: modelSummaryFallback
      ? "Margins reviewed the source, but no card summary came back. Showing the local summary."
      : modelReturnedNoQuestions
        ? "Margins found no required follow-up questions."
        : "Margins reviewed the source against the current vault.",
    missionFrame,
    takeaways,
    lightTouch,
    propagation,
    filingPlan,
    filingSteps,
    discoveries,
    financialDetails,
    summary: displaySummaryParts.overview,
    summaryBullets: displaySummaryParts.bullets,
    connections: connections
      .map((connection) => ({
        path: String(connection.path || "").trim(),
        title: String(connection.title || "").trim(),
        type: /new/i.test(connection.type || "") ? "new" : "existing",
        relevance: relevanceValue(connection.relevance),
        reason: cleanSummary(connection.reason || "")
      }))
      .filter((connection) => connection.title || connection.path || connection.reason)
      .slice(0, 5),
    questions: parsedQuestions,
    modelReturnedNoQuestions,
    modelSummaryFallback,
    fallbackQuestions: []
  };
}

function filingPlanQuestions(file, plan) {
  if (!hasFilingPlan(plan)) return [];
  const questions = [];
  const placement = plan.placement || {};
  if (placement.alternatives?.length) {
    questions.push(reviewQuestion(
      "suggest",
      "Bucket",
      rawSourceOutputPath(file.name),
      `File this in ${placement.bucket || "sources"} or use another proposed bucket?`,
      placement.reason || "The source has more than one plausible home.",
      `My take: use ${placement.path || placement.bucket || "the recommended path"}.`,
      [placement.path || placement.bucket, ...placement.alternatives, "Skip"].filter(Boolean).slice(0, 4)
    ));
  }
  if (plan.typeTagNote && !plan.typeTag) {
    questions.push(reviewQuestion(
      "suggest",
      "Type tag",
      rawSourceOutputPath(file.name),
      "This source does not fit the closed type-tag set cleanly. Leave type blank for now?",
      plan.typeTagNote,
      "My take: leave the source page typed as source and use topic tags until the tag set is extended.",
      ["Leave blank", "Use closest existing type", "Skip"]
    ));
  }
  if (plan.promotion?.candidate && /wait|hold|later|second|another/i.test(`${plan.promotion.recommendation} ${plan.promotion.reason}`)) {
    questions.push(reviewQuestion(
      "suggest",
      "Promotion",
      rawSourceOutputPath(file.name),
      `Promote ${plan.promotion.candidate} now, or wait for another source?`,
      plan.promotion.reason || "Promotion changes whether Margins creates a durable concept page.",
      plan.promotion.recommendation || "My take: wait until there is another supporting source.",
      ["Wait", "Promote now", "Skip"]
    ));
  }
  return questions;
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
  const questions = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.questions) ? parsed.questions : [];
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

  const title = parsedMode ? "Returned files" : "Processing preview";
  const createCount = summaryChanges.filter((change) => change.status === "create").length;
  const overwriteCount = summaryChanges.filter((change) => change.status === "overwrite").length;
  const unchangedCount = summaryChanges.filter((change) => change.status === "unchanged").length;
  const rawCreateCount = rawChanges.filter((change) => change.status === "create").length;
  const rawOverwriteCount = rawChanges.filter((change) => change.status === "overwrite").length;
  const summaryParts = [
    createCount ? `${createCount} new` : "",
    overwriteCount ? `${overwriteCount} overwrite` : "",
    rawCreateCount ? `${rawCreateCount} source new` : "",
    rawOverwriteCount ? `${rawOverwriteCount} source overwrite` : "",
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
    ...rawChanges.map((change) => ({ ...change, kind: "source file" }))
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
  return change.path.startsWith(`${RAW_SOURCE_DIR}/`) ||
    change.path.startsWith(`${LEGACY_RAW_SOURCE_DIR}/`) ||
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
  syncPendingSourceList(files);
  if (els.queuePanel) els.queuePanel.hidden = false;
  renderPendingCount(files.length);
  if (files.length === 0) {
    els.sourceList.className = "source-list empty";
    els.sourceList.textContent = "No pending sources.";
    renderRecentActivity();
    return;
  }
  const visibleCount = visiblePendingSourceCount(files.length);
  const visibleFiles = files.slice(0, visibleCount);
  els.sourceList.className = "source-list";
  els.sourceList.innerHTML = `
    ${visibleFiles.map((file) => `
    <div class="source-item ${sourceClass(file)}">
      <button class="source-remove-btn" type="button" data-source-delete="${escapeHtml(file.name)}" aria-label="Remove ${escapeHtml(file.name)}">
        <span aria-hidden="true">×</span>
      </button>
      <span class="source-badge ${escapeHtml(sourceBadgeClass(file))}">${escapeHtml(sourceTypeLabel(file))}</span>
      <div class="source-copy">
        <strong>${escapeHtml(file.name)}</strong>
        ${renderSourceTimestamp(file)}
      </div>
      ${showTopSourceAction(file) ? renderSourceActionButton(file, "source-process-btn") : renderSourceTopStatus(file)}
      ${renderSourceIngestRun(file)}
    </div>
  `).join("")}
    ${renderPendingSourceActions(visibleCount, files.length)}
  `;
  bindSourceListControls();
  renderRecentActivity();
}

function renderPendingCount(count = 0) {
  if (!els.pendingCountLabel) return;
  els.pendingCountLabel.textContent = `${formatStatNumber(count)} pending`;
}

function syncPendingSourceList(files = state.files) {
  const sourceKey = files.map((file) => file.name).join("\n");
  if (sourceKey === state.pendingSourceKey) return;
  state.pendingSourceKey = sourceKey;
  resetPendingSourceLimit();
}

function resetPendingSourceLimit() {
  state.pendingSourceVisibleCount = PENDING_SOURCE_PAGE_SIZE;
}

function visiblePendingSourceCount(totalCount) {
  if (totalCount <= PENDING_SOURCE_PAGE_SIZE) return totalCount;
  const requested = Math.max(
    PENDING_SOURCE_PAGE_SIZE,
    Number(state.pendingSourceVisibleCount) || PENDING_SOURCE_PAGE_SIZE
  );
  state.pendingSourceVisibleCount = Math.min(requested, totalCount);
  return state.pendingSourceVisibleCount;
}

function renderPendingSourceActions(visibleCount, totalCount) {
  if (visibleCount >= totalCount) return "";
  const remaining = totalCount - visibleCount;
  const nextCount = Math.min(PENDING_SOURCE_PAGE_SIZE, remaining);
  const showMoreLabel = remaining > PENDING_SOURCE_PAGE_SIZE ? `Show ${nextCount} more` : `Show remaining ${remaining}`;
  return `
    <div class="entity-section-actions pending-section-actions">
      <button class="entity-list-button primary" type="button" data-pending-list-action="show-more" data-pending-source-total="${escapeHtml(String(totalCount))}">
        ${escapeHtml(showMoreLabel)}
      </button>
      <button class="entity-list-button" type="button" data-pending-list-action="show-all" data-pending-source-total="${escapeHtml(String(totalCount))}">
        Show all ${escapeHtml(String(totalCount))}
      </button>
    </div>
  `;
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

function activeActivityFileMap() {
  return state.currentFileMap || state.loadedFileMap || new Map();
}

function renderRecentActivity(fileMap = activeActivityFileMap()) {
  if (!els.recentActivityList) return;
  const activeFileMap = fileMap instanceof Map ? fileMap : new Map();
  const records = activityTimelineRecords(activeFileMap);
  syncActivityRecentSource(records);

  if (records.length === 0 && activeFileMap.size === 0) {
    els.recentActivityList.className = "activity-card-wall empty";
    els.recentActivityList.textContent = "Open a vault to see recently processed source notes.";
    return;
  }

  if (records.length === 0) {
    els.recentActivityList.className = "activity-card-wall empty";
    els.recentActivityList.textContent = "No processed source notes found in this vault yet.";
    return;
  }

  const visibleCount = visibleActivityRecentCount(records.length);
  const visibleRecords = records.slice(0, visibleCount);
  els.recentActivityList.className = "activity-card-wall";
  els.recentActivityList.innerHTML = `
    ${visibleRecords.map(renderRecentActivityCard).join("")}
    ${renderActivityRecentActions(visibleCount, records.length)}
  `;
}

function renderDream(fileMap = activeActivityFileMap()) {
  if (!els.dreamProposalList) return;
  const activeFileMap = fileMap instanceof Map ? fileMap : new Map();
  const report = dreamReport(activeFileMap);
  const visibleQueue = state.dreamLastRun ? dreamVisibleQueueItems(report.queueItems) : [];
  if (els.dreamStateCard) {
    els.dreamStateCard.classList.toggle("is-dreaming", Boolean(state.dreamLastRun?.running));
  }

  if (els.dreamMeta) els.dreamMeta.textContent = report.meta;
  if (els.dreamStateTitle) els.dreamStateTitle.textContent = report.title;
  if (els.dreamStateBody) els.dreamStateBody.textContent = report.body;
  if (els.dreamPassStatus) {
    els.dreamPassStatus.textContent = report.passStatus;
    els.dreamPassStatus.hidden = !state.dreamLastRun;
  }
  if (els.dreamRunBtn) {
    els.dreamRunBtn.disabled = !report.connected || Boolean(state.dreamLastRun?.running);
    els.dreamRunBtn.textContent = state.dreamLastRun?.running ? "Cleaning..." : "Run cleanup";
  }
  if (els.dreamReviewBtn) els.dreamReviewBtn.disabled = !report.connected || report.reviewItemCount === 0;
  if (els.dreamModeToggle) els.dreamModeToggle.value = state.dreamMode;
  if (els.dreamModeHelp) els.dreamModeHelp.textContent = "Automatically cleans low-risk retrieval issues, then asks only about risky changes.";
  if (els.dreamOperationList) {
    els.dreamOperationList.innerHTML = report.operations.map((operation) => `
      <article class="dream-op-card ${escapeHtml(operation.state)}">
        <div class="dream-op-top">
          <span>${escapeHtml(operation.name)}</span>
          <strong>${escapeHtml(operation.metric)}</strong>
        </div>
        <p>${escapeHtml(operation.description)}</p>
        <div class="dream-stage-counts">
          <span>${escapeHtml(String(operation.queued))} queued</span>
          <span>${escapeHtml(String(operation.applied))} applied</span>
          <span>${escapeHtml(String(operation.deferred))} review</span>
        </div>
      </article>
    `).join("");
  }
  if (els.dreamQueueKicker) els.dreamQueueKicker.textContent = state.dreamLastRun ? "Needs your call" : "Cleanup";
  if (els.dreamQueueTitle) {
    els.dreamQueueTitle.textContent = !state.dreamLastRun
      ? "Run cleanup to see what needs your call"
      : visibleQueue.length
        ? `${formatStatNumber(report.reviewItemCount)} risky item${report.reviewItemCount === 1 ? "" : "s"} to review`
        : "No risky cleanup decisions";
  }
  els.dreamProposalList.innerHTML = visibleQueue.length
    ? visibleQueue.map((proposal, index) => renderDreamQueueCard(proposal, index, report.reviewItemCount)).join("")
    : `<div class="dream-empty">${escapeHtml(state.dreamLastRun ? report.emptyQueueText : "Run cleanup when you want Margins to improve retrieval and queue only the risky calls.")}</div>`;
  renderDreamPreparedRunPanel(activeFileMap, report);
  if (els.dreamLogMeta) els.dreamLogMeta.textContent = report.log;
  if (els.dreamLogEntries) {
    els.dreamLogEntries.innerHTML = report.logEntries.length
      ? report.logEntries.map(renderDreamActivityEntry).join("")
      : "";
  }
}

function renderDreamActivityEntry(entry) {
  const kind = entry.kind ? ` ${escapeHtml(entry.kind)}` : "";
  const details = [
    entry.file ? `<small><strong>File</strong><span>${escapeHtml(entry.file)}</span></small>` : "",
    entry.broken ? `<small><strong>Broken</strong><span>[[${escapeHtml(entry.broken)}]]</span></small>` : "",
    entry.changedTo ? `<small><strong>Changed to</strong><span>[[${escapeHtml(entry.changedTo)}]]</span></small>` : "",
    entry.context ? `<small>${escapeHtml(entry.context)}</small>` : ""
  ].filter(Boolean).join("");
  return `
    <li class="dream-activity-item${kind}">
      <span>${escapeHtml(entry.title)}</span>
      ${details}
    </li>
  `;
}

function renderDreamQueueCard(proposal, index, reviewTotal) {
  const stepLabel = state.dreamReviewActive && proposal.safety === "review"
    ? `Step ${index + 1} of ${reviewTotal}`
    : proposal.disabled
      ? "Nothing to do"
      : proposal.safety === "auto" ? "Safe" : "Review";
  const stageLabel = dreamStageName(proposal.stage);
  const runText = proposal.runBody || (proposal.safety === "auto"
    ? "Cleanup can apply this automatically."
    : "Runs the configured API and opens proposed file changes for review before anything is saved.");
  return `
    <article class="dream-proposal-card ${escapeHtml(proposal.safety)} ${proposal.disabled ? "disabled" : ""}">
      <div>
        <div class="dream-proposal-topline">
          <span class="dream-proposal-kind">${escapeHtml(stepLabel)}</span>
          <span class="dream-proposal-stage">${escapeHtml(stageLabel)}</span>
        </div>
        <h4>${escapeHtml(proposal.title)}</h4>
        <div class="dream-proposal-details">
          <div>
            <span>Found</span>
            <p>${escapeHtml(proposal.body)}</p>
          </div>
          <div>
            <span>When clicked</span>
            <p>${escapeHtml(runText)}</p>
          </div>
        </div>
      </div>
      <div class="dream-proposal-actions" aria-label="Dream proposal actions">
        <button type="button" data-dream-action="${escapeHtml(proposal.action || "")}" data-dream-target="${escapeHtml(proposal.target || "")}" ${proposal.disabled ? "disabled" : ""}>
          ${escapeHtml(proposal.actionLabel || "Open")}
        </button>
        ${state.dreamReviewActive && proposal.safety === "review" ? `
          <button type="button" data-dream-action="skip-dream-item" data-dream-target="${escapeHtml(proposal.id)}">Skip</button>
        ` : ""}
      </div>
    </article>
  `;
}

function dreamVisibleQueueItems(items = []) {
  const activeItems = items.filter((item) => !state.dreamSkippedItems.has(item.id));
  if (!state.dreamLastRun) return [];
  if (!state.dreamReviewActive) return activeItems.slice(0, 6);
  const reviewItems = activeItems.filter((item) => item.safety === "review" && !item.disabled);
  return reviewItems.length ? reviewItems.slice(0, 6) : activeItems.slice(0, 6);
}

function prepareDreamHelperRun(itemId) {
  const fileMap = activeActivityFileMap();
  if (!fileMap?.size) return;
  const stats = dreamVaultStats(fileMap);
  const item = dreamRepairItems(stats).find((entry) => entry.id === itemId);
  if (!item || item.disabled) return;
  const limits = dreamDefaultRunLimits(item.id, stats);
  state.dreamPreparedRun = buildDreamPreparedRun(item, stats, fileMap, limits);
  state.dreamReviewActive = false;
  renderDream(fileMap);
  els.dreamRunPanel?.scrollIntoView({ block: "center", behavior: "smooth" });
}

function buildDreamPreparedRun(item, stats, fileMap, limits, status = "") {
  const normalizedLimits = normalizeDreamRunLimits(limits, item.id, stats);
  const prompt = buildDreamCleanupPrompt(item, stats, fileMap, normalizedLimits);
  const model = dreamGeminiModel();
  const outputTokenLimit = apiOutputTokenLimit(DREAM_HELPER_OUTPUT_TOKEN_FLOOR);
  const inputTokens = estimateRequestInputTokens(prompt, []);
  const estimatedUsd = estimateModelCostUsd(model, inputTokens, outputTokenLimit);
  const contextStats = dreamPreparedRunContextStats(item, stats, fileMap, normalizedLimits, prompt);
  return {
    itemId: item.id,
    item,
    limits: normalizedLimits,
    prompt,
    contextStats,
    estimate: {
      model,
      inputTokens,
      outputTokenLimit,
      totalTokens: inputTokens + outputTokenLimit,
      estimatedUsd,
      priceSource: pricingForModel(model).source
    },
    status,
    running: false
  };
}

function renderDreamPreparedRunPanel(fileMap, report) {
  if (!els.dreamRunPanel) return;
  const prepared = state.dreamPreparedRun;
  if (!prepared) {
    els.dreamRunPanel.hidden = true;
    return;
  }
  const stats = dreamVaultStats(fileMap);
  const freshItem = dreamRepairItems(stats).find((item) => item.id === prepared.itemId);
  if (!freshItem || freshItem.disabled) {
    state.dreamPreparedRun = null;
    els.dreamRunPanel.hidden = true;
    return;
  }

  els.dreamRunPanel.hidden = false;
  if (els.dreamRunTitle) els.dreamRunTitle.textContent = freshItem.title;
  if (els.dreamRunSummary) {
    els.dreamRunSummary.textContent = prepared.itemId === "clearance-broken-links"
      ? "Review the affected page, missing link, and suggested target before saving."
      : "Margins will send one bounded batch to Gemini. Review returned file changes before saving.";
  }
  if (els.dreamRunScope) {
    els.dreamRunScope.innerHTML = `
      ${dreamRunScopeRows(prepared, stats).map((row) => `
      <div>
        <span>${escapeHtml(row.label)}</span>
        <strong>${escapeHtml(row.value)}</strong>
      </div>
      `).join("")}
      ${dreamRunDetailHtml(prepared, fileMap)}
    `;
  }
  if (els.dreamLimitItemsLabel) els.dreamLimitItemsLabel.textContent = dreamRunItemLimitLabel(prepared.itemId);
  if (els.dreamLimitFilesLabel) els.dreamLimitFilesLabel.textContent = dreamRunFileLimitLabel(prepared.itemId);
  if (els.dreamLimitItems) els.dreamLimitItems.value = String(prepared.limits.maxItems);
  if (els.dreamLimitFiles) els.dreamLimitFiles.value = String(prepared.limits.maxFiles);
  if (els.dreamLimitUsd) els.dreamLimitUsd.value = String(prepared.limits.maxUsd);
  if (els.dreamRunEstimate) {
    const overLimit = prepared.estimate.estimatedUsd > prepared.limits.maxUsd;
    const message = [
      `Gemini · ${prepared.estimate.model}`,
      `${formatStatNumber(prepared.estimate.inputTokens)} input tokens`,
      `${formatStatNumber(prepared.estimate.outputTokenLimit)} max output`,
      `${formatUsd(prepared.estimate.estimatedUsd)} estimated`,
      `${formatUsd(prepared.limits.maxUsd)} hard stop`
    ].join(" · ");
    els.dreamRunEstimate.textContent = prepared.status || (overLimit
      ? `${message}. Reduce scope or raise the hard stop before running.`
      : message);
    els.dreamRunEstimate.classList.toggle("warn", overLimit || Boolean(prepared.status));
  }
  if (els.dreamRunPreparedBtn) {
    const overLimit = prepared.estimate.estimatedUsd > prepared.limits.maxUsd;
    els.dreamRunPreparedBtn.disabled = prepared.running || overLimit;
    els.dreamRunPreparedBtn.textContent = prepared.running
      ? "Running Gemini..."
      : prepared.itemId === "clearance-broken-links"
        ? "Ask AI"
        : "Ask AI";
  }
  if (els.dreamRunCancelBtn) els.dreamRunCancelBtn.disabled = prepared.running;
  if (els.dreamRunCancelSecondaryBtn) els.dreamRunCancelSecondaryBtn.disabled = prepared.running;
}

function dreamRunScopeRows(prepared, stats) {
  const rows = [];
  if (prepared.itemId === "clearance-broken-links") {
    rows.push({ label: "Found", value: `${formatStatNumber(stats.brokenLinkCount)} broken links` });
    rows.push({ label: "This batch", value: dreamRunBatchDescription(prepared.itemId, prepared.limits, stats) });
    if (prepared.contextStats?.fileCount) {
      rows.push({
        label: "Files",
        value: `${formatStatNumber(prepared.contextStats.fileCount)} files · ${formatByteSize(prepared.contextStats.totalBytes)} local size`
      });
    }
    if (prepared.contextStats?.largestFilePath) {
      rows.push({
        label: "Largest",
        value: `${basename(prepared.contextStats.largestFilePath)} · ${formatByteSize(prepared.contextStats.largestFileBytes)}`
      });
    }
    if (prepared.contextStats?.snippetOnlyCount) {
      rows.push({
        label: "Context",
        value: `${formatStatNumber(prepared.contextStats.snippetOnlyCount)} large file${prepared.contextStats.snippetOnlyCount === 1 ? "" : "s"} snippet-only`
      });
    }
  } else if (prepared.itemId === "pruning-sparse-entities") {
    rows.push({ label: "Found", value: `${formatStatNumber(stats.sparseEntityCount)} sparse entities` });
    rows.push({ label: "This batch", value: dreamRunBatchDescription(prepared.itemId, prepared.limits, stats) });
  } else if (prepared.itemId === "association-source-links") {
    rows.push({ label: "Available", value: `${formatStatNumber(stats.sourceCount)} source notes` });
    rows.push({ label: "This batch", value: dreamRunBatchDescription(prepared.itemId, prepared.limits, stats) });
  } else if (prepared.itemId === "synthesis-cross-source") {
    rows.push({ label: "Available", value: `${formatStatNumber(stats.sourceCount)} source notes` });
    rows.push({ label: "This batch", value: dreamRunBatchDescription(prepared.itemId, prepared.limits, stats) });
  }
  rows.push({ label: "Result", value: "Proposed file edits only" });
  return rows;
}

function dreamRunDetailHtml(prepared, fileMap) {
  if (prepared.itemId !== "clearance-broken-links") return "";
  const stats = dreamVaultStats(fileMap || new Map());
  const items = dreamBrokenLinkReviewItems(stats, fileMap, prepared.limits);
  if (!items.length) return "";
  return `
    <div class="dream-link-review">
      <div class="dream-link-review-head">
        <span>Broken link review</span>
        <strong>${escapeHtml(`${formatStatNumber(items.length)} selected for this batch`)}</strong>
      </div>
      <div class="dream-link-review-list">
        ${items.map((item) => renderDreamBrokenLinkReviewCard(item)).join("")}
      </div>
    </div>
  `;
}

function renderDreamBrokenLinkReviewCard(item) {
  const suggestion = item.suggestion;
  const suggestedLink = suggestion ? `[[${wikiLinkTargetForPath(suggestion.path)}]]` : "";
  const targetText = suggestion
    ? `Replace [[${item.to}]] with ${suggestedLink}.`
    : "No existing page looks like the right target.";
  return `
    <article class="dream-link-card">
      <div class="dream-link-card-title">
        <span>Review this link</span>
        <strong>${escapeHtml(`Fix [[${item.to}]] in ${item.fromTitle || item.from}`)}</strong>
      </div>
      <div class="dream-link-card-main">
        <div class="dream-link-fact">
          <span>File to edit</span>
          <button class="dream-link-path" type="button" data-dream-run-open="${escapeHtml(item.from)}">${escapeHtml(item.fromTitle || item.from)}</button>
          <small>${escapeHtml(item.from)}</small>
        </div>
        <div class="dream-link-fact">
          <span>Broken link</span>
          <strong>${escapeHtml(`[[${item.to}]]`)}</strong>
          <small>${escapeHtml(`Flagged because no page in this vault matches this wikilink.`)}</small>
        </div>
        <div class="dream-link-fact">
          <span>Proposed fix</span>
          ${suggestion ? `
            <button class="dream-link-path" type="button" data-dream-run-open="${escapeHtml(suggestion.path)}">${escapeHtml(suggestion.title)}</button>
            <small>${escapeHtml(`${targetText} Target file: ${suggestion.path}. ${suggestion.confidence}.`)}</small>
          ` : `
            <strong>No confident existing page</strong>
            <small>${escapeHtml(`${targetText} Open the file, create/rename a target, or decline this warning for now.`)}</small>
          `}
        </div>
      </div>
      <div class="dream-link-context">
        <span>Where it appears</span>
        <strong>${escapeHtml(item.context.heading ? `${item.context.heading} · line ${item.lineNumber}` : `Line ${item.lineNumber}`)}</strong>
        <blockquote>${escapeHtml(item.context.excerpt || item.linePreview || `[[${item.to}]]`)}</blockquote>
      </div>
      <div class="dream-link-actions">
        <button type="button" data-dream-run-open="${escapeHtml(item.from)}">Open file</button>
        ${suggestion ? `<button type="button" data-dream-run-open="${escapeHtml(suggestion.path)}">Open target</button>` : ""}
        <button type="button" data-dream-approve-broken-link data-dream-from="${escapeHtml(item.from)}" data-dream-broken="${escapeHtml(item.to)}" data-dream-target-path="${escapeHtml(suggestion?.path || "")}" ${suggestion ? "" : "disabled"}>
          Approve
        </button>
        <button type="button" data-dream-dismiss-broken-link data-dream-from="${escapeHtml(item.from)}" data-dream-broken="${escapeHtml(item.to)}">
          Decline
        </button>
      </div>
    </article>
  `;
}

function dreamBrokenLinkReviewItems(stats, fileMap, limits = {}) {
  const batch = dreamBrokenLinkBatch(stats, fileMap, limits);
  return batch.links.map((link) => {
    const body = fileMap?.get(link.from) || "";
    const lineNumber = lineNumberAtIndex(body, Math.max(0, dreamBrokenLinkIndex(body, link.to)));
    return {
      ...link,
      fromTitle: dreamBrokenLinkSourceTitle(link.from, body),
      lineNumber,
      context: dreamBrokenLinkContext(body, link.to),
      linePreview: dreamBrokenLinkLinePreview(body, link.to),
      suggestion: dreamBrokenLinkSuggestion(link.to, fileMap, link.from)
    };
  });
}

function dreamBrokenLinkSourceTitle(path, body) {
  return markdownTitle(body) || titleFromSlug(basename(path).replace(/\.md$/, ""));
}

function dreamBrokenLinkLinePreview(body, target) {
  const index = dreamBrokenLinkIndex(body, target);
  if (index < 0) return "";
  const start = body.lastIndexOf("\n", index) + 1;
  const nextLine = body.indexOf("\n", index);
  const end = nextLine >= 0 ? nextLine : body.length;
  return clampPreservedContext(cleanBrokenLinkContextText(body.slice(start, end)), 160);
}

function dreamBrokenLinkContext(body, target) {
  const index = dreamBrokenLinkIndex(body, target);
  if (index < 0) return { heading: "", excerpt: "" };
  const heading = nearestMarkdownHeadingBefore(body, index);
  const range = paragraphRangeAroundIndex(body, index);
  const excerpt = clampPreservedContext(cleanBrokenLinkContextText(body.slice(range.start, range.end)), 360);
  return {
    heading,
    excerpt
  };
}

function nearestMarkdownHeadingBefore(body, index) {
  const before = String(body || "").slice(0, Math.max(0, index)).split("\n").reverse();
  const heading = before.find((line) => /^#{1,4}\s+\S/.test(line.trim()));
  return heading ? heading.replace(/^#{1,4}\s+/, "").trim() : "";
}

function paragraphRangeAroundIndex(body, index) {
  const text = String(body || "");
  let start = text.lastIndexOf("\n\n", Math.max(0, index));
  start = start >= 0 ? start + 2 : text.lastIndexOf("\n", Math.max(0, index)) + 1;
  let end = text.indexOf("\n\n", Math.max(0, index));
  if (end < 0) end = text.indexOf("\n", Math.max(0, index));
  if (end < 0) end = text.length;
  if (end - start > 520) {
    const snippet = dreamSnippetRange(text, index, 240);
    return { start: snippet.start, end: snippet.end };
  }
  return { start: Math.max(0, start), end: Math.min(text.length, end) };
}

function cleanBrokenLinkContextText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clampPreservedContext(value, limit) {
  const text = cleanBrokenLinkContextText(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 3).trim()}...`;
}

function dreamBrokenLinkSuggestion(target, fileMap, fromPath) {
  const query = cleanWikiLinkLabel(target);
  if (!query || !fileMap?.size) return null;
  const candidates = dreamWikiLinkTargetRecords(fileMap, fromPath)
    .map((record) => ({
      ...record,
      score: dreamLinkMatchScore(query, record)
    }))
    .filter((record) => record.score >= 42)
    .sort((left, right) => (
      right.score - left.score ||
      left.path.localeCompare(right.path)
    ));
  const best = candidates[0];
  if (!best) return null;
  return {
    path: best.path,
    title: best.title,
    score: best.score,
    confidence: dreamBrokenLinkConfidenceLabel(best.score)
  };
}

function dreamWikiLinkTargetRecords(fileMap, fromPath) {
  return [...(fileMap || new Map()).entries()]
    .filter(([path]) => path.startsWith("wiki/") && path.endsWith(".md") && path !== fromPath && !path.startsWith("wiki/.margins/") && !path.startsWith("wiki/_templates/"))
    .map(([path, body]) => {
      const title = markdownTitle(body) || titleFromSlug(basename(path).replace(/\.md$/, ""));
      const fields = frontmatterFields(body);
      const labels = [
        title,
        basename(path).replace(/\.md$/, ""),
        path.replace(/^wiki\//, "").replace(/\.md$/, ""),
        ...frontmatterList(fields.aliases),
        ...frontmatterList(fields.alias)
      ].filter(Boolean);
      return {
        path,
        title,
        type: fields.type || graphTypeFromPath(path, body),
        labels
      };
    });
}

function dreamLinkMatchScore(query, record) {
  const querySlug = slugifyLoose(query);
  const queryTokens = linkMatchTokens(querySlug);
  if (!querySlug || !queryTokens.length) return 0;
  let best = 0;
  for (const label of record.labels || []) {
    const labelSlug = slugifyLoose(label);
    if (!labelSlug) continue;
    if (labelSlug === querySlug) best = Math.max(best, 100);
    if (labelSlug.startsWith(`${querySlug}-`)) best = Math.max(best, 88);
    if (querySlug.startsWith(`${labelSlug}-`)) best = Math.max(best, 76);
    best = Math.max(best, Math.round(tokenOverlapScore(queryTokens, linkMatchTokens(labelSlug)) * 76));
    best = Math.max(best, Math.round(stringSimilarityScore(querySlug, labelSlug) * 62));
  }
  if (record.type === "source") best = Math.max(0, best - 8);
  return best;
}

function linkMatchTokens(value) {
  return slugifyLoose(value)
    .split("-")
    .filter((token) => token.length > 1 && !STOP_WORDS_FOR_CONTEXT.has(token));
}

function tokenOverlapScore(leftTokens, rightTokens) {
  if (!leftTokens.length || !rightTokens.length) return 0;
  const right = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => right.has(token)).length;
  return overlap / Math.min(leftTokens.length, rightTokens.length);
}

function stringSimilarityScore(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  if (!leftBigrams.length || !rightBigrams.length) return 0;
  const rightCounts = new Map();
  for (const bigram of rightBigrams) rightCounts.set(bigram, (rightCounts.get(bigram) || 0) + 1);
  let shared = 0;
  for (const bigram of leftBigrams) {
    const count = rightCounts.get(bigram) || 0;
    if (!count) continue;
    shared += 1;
    rightCounts.set(bigram, count - 1);
  }
  return (2 * shared) / (leftBigrams.length + rightBigrams.length);
}

function bigrams(value) {
  const text = String(value || "");
  if (text.length < 2) return [];
  const grams = [];
  for (let index = 0; index < text.length - 1; index += 1) {
    grams.push(text.slice(index, index + 2));
  }
  return grams;
}

function dreamBrokenLinkConfidenceLabel(score) {
  if (score >= 82) return "High confidence";
  if (score >= 62) return "Likely match";
  return "Possible match";
}

function dreamRunBatchDescription(itemId, limits, stats) {
  if (itemId === "clearance-broken-links") {
    const batch = dreamBrokenLinkBatch(stats, null, limits);
    const links = batch.links.length || Math.min(stats.brokenLinkCount || limits.maxItems, limits.maxItems);
    const files = batch.affectedPaths.length || Math.min(limits.maxFiles, stats.brokenLinkCount || limits.maxFiles);
    return `${formatStatNumber(links)} links across ${formatStatNumber(files)} files max`;
  }
  if (itemId === "pruning-sparse-entities") {
    const entities = Math.min(stats.sparseEntityCount || limits.maxItems, limits.maxItems);
    return `${formatStatNumber(entities)} entity pages, ${formatStatNumber(limits.maxFiles)} source files max`;
  }
  if (itemId === "association-source-links") {
    return `${formatStatNumber(limits.maxItems)} sources, ${formatStatNumber(limits.maxFiles)} durable pages max`;
  }
  if (itemId === "synthesis-cross-source") {
    return `${formatStatNumber(limits.maxItems)} sources, one draft max`;
  }
  return `${formatStatNumber(limits.maxItems)} items, ${formatStatNumber(limits.maxFiles)} files max`;
}

function dreamPreparedRunContextStats(item, stats, fileMap, limits, prompt = "") {
  if (item.id !== "clearance-broken-links") {
    return {
      promptBytes: textSizeBytes(prompt)
    };
  }
  const batch = dreamBrokenLinkBatch(stats, fileMap, limits);
  const fileSizes = batch.affectedPaths
    .map((path) => ({
      path,
      bytes: textSizeBytes(fileMap?.get(path) || "")
    }))
    .sort((left, right) => right.bytes - left.bytes);
  const largest = fileSizes[0] || null;
  return {
    promptBytes: textSizeBytes(prompt),
    fileCount: fileSizes.length,
    totalBytes: fileSizes.reduce((sum, file) => sum + file.bytes, 0),
    largestFilePath: largest?.path || "",
    largestFileBytes: largest?.bytes || 0,
    snippetOnlyCount: fileSizes.filter((file) => (fileMap?.get(file.path) || "").length > DREAM_BROKEN_LINK_FULL_FILE_CHAR_LIMIT).length,
    selectedLinkCount: batch.links.length,
    skippedLinkCount: Math.max(0, (stats.brokenLinkCount || 0) - batch.links.length)
  };
}

function dreamBrokenLinkBatch(stats, fileMap, limits = {}) {
  const maxLinks = positiveInteger(limits.maxItems, DREAM_BROKEN_LINK_DEFAULT_MAX_LINKS);
  const maxFiles = positiveInteger(limits.maxFiles, DREAM_BROKEN_LINK_DEFAULT_MAX_FILES);
  const links = [];
  const affectedPaths = [];
  const seenPaths = new Set();

  for (const link of stats.brokenLinks || []) {
    if (links.length >= maxLinks) break;
    const path = link.from;
    if (!path || (fileMap && !fileMap.has(path))) continue;
    if (!seenPaths.has(path)) {
      if (seenPaths.size >= maxFiles) continue;
      seenPaths.add(path);
      affectedPaths.push(path);
    }
    links.push(link);
  }

  return { links, affectedPaths };
}

function dreamDefaultRunLimits(itemId, stats = {}) {
  if (itemId === "clearance-broken-links") return {
    maxItems: Math.min(DREAM_BROKEN_LINK_DEFAULT_MAX_LINKS, Math.max(1, stats.brokenLinkCount || DREAM_BROKEN_LINK_DEFAULT_MAX_LINKS)),
    maxFiles: DREAM_BROKEN_LINK_DEFAULT_MAX_FILES,
    maxUsd: 0.25
  };
  if (itemId === "pruning-sparse-entities") return { maxItems: Math.min(10, Math.max(1, stats.sparseEntityCount || 10)), maxFiles: 10, maxUsd: 0.25 };
  if (itemId === "association-source-links") return { maxItems: 10, maxFiles: 24, maxUsd: 0.25 };
  if (itemId === "synthesis-cross-source") return { maxItems: 12, maxFiles: 8, maxUsd: 0.25 };
  return { maxItems: 10, maxFiles: 10, maxUsd: 0.25 };
}

function normalizeDreamRunLimits(limits = {}, itemId = "", stats = {}) {
  const defaults = dreamDefaultRunLimits(itemId, stats);
  return {
    maxItems: clampInteger(limits.maxItems, 1, 200, defaults.maxItems),
    maxFiles: clampInteger(limits.maxFiles, 1, 80, defaults.maxFiles),
    maxUsd: clampNumber(limits.maxUsd, 0.01, 10, defaults.maxUsd)
  };
}

function clampInteger(value, min, max, fallback) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed * 100) / 100));
}

function dreamRunItemLimitLabel(itemId) {
  if (itemId === "clearance-broken-links") return "Max links";
  if (itemId === "pruning-sparse-entities") return "Max entities";
  return "Max sources";
}

function dreamRunFileLimitLabel(itemId) {
  if (itemId === "association-source-links") return "Max pages";
  if (itemId === "synthesis-cross-source") return "Existing summaries";
  return "Max files";
}

function dreamGeminiModel() {
  const selectedProvider = els.apiProvider?.value || providerValue(state.apiSettings.providerLabel);
  return selectedProvider === "gemini" && els.apiModel?.value.trim()
    ? els.apiModel.value.trim()
    : defaultModelForProvider("gemini");
}

function handleDreamRunLimitChange() {
  if (!state.dreamPreparedRun) return;
  const fileMap = activeActivityFileMap();
  const stats = dreamVaultStats(fileMap);
  const item = dreamRepairItems(stats).find((entry) => entry.id === state.dreamPreparedRun.itemId);
  if (!item) return;
  state.dreamPreparedRun = buildDreamPreparedRun(item, stats, fileMap, {
    maxItems: els.dreamLimitItems?.value,
    maxFiles: els.dreamLimitFiles?.value,
    maxUsd: els.dreamLimitUsd?.value
  });
  renderDreamPreparedRunPanel(fileMap, dreamReport(fileMap));
}

function clearDreamPreparedRun() {
  state.dreamPreparedRun = null;
  renderDream(activeActivityFileMap());
}

function handleDreamRunScopeClick(event) {
  const approveButton = event.target.closest("[data-dream-approve-broken-link]");
  if (approveButton && els.dreamRunScope?.contains(approveButton)) {
    event.preventDefault();
    const applied = approveDreamBrokenLink(
      approveButton.dataset.dreamFrom,
      approveButton.dataset.dreamBroken,
      approveButton.dataset.dreamTargetPath
    );
    if (applied) {
      approveButton.textContent = "Approved";
      approveButton.disabled = true;
    }
    return;
  }

  const dismissButton = event.target.closest("[data-dream-dismiss-broken-link]");
  if (dismissButton && els.dreamRunScope?.contains(dismissButton)) {
    event.preventDefault();
    dismissDreamBrokenLink(dismissButton.dataset.dreamFrom, dismissButton.dataset.dreamBroken);
    return;
  }

  const openButton = event.target.closest("[data-dream-run-open]");
  if (openButton && els.dreamRunScope?.contains(openButton)) {
    event.preventDefault();
    const path = openButton.dataset.dreamRunOpen;
    if (!path) return;
    activateTab("wiki");
    selectVaultPath(path);
  }
}

function dismissDreamBrokenLink(fromPath, brokenTarget) {
  const key = dreamBrokenLinkKey(fromPath, brokenTarget);
  if (!key) return false;
  state.dreamDismissedBrokenLinks.add(key);
  renderDream(activeActivityFileMap());
  return true;
}

function autoRepairDreamBrokenLinks(fileMap, stats) {
  if (!fileMap?.size || !stats?.brokenLinks?.length) return [];
  const items = dreamBrokenLinkReviewItems(stats, fileMap, {
    maxItems: 200,
    maxFiles: 80
  });
  const repairs = [];
  for (const item of items) {
    if (!item.suggestion || item.suggestion.score < DREAM_AUTO_LINK_SCORE) continue;
    const body = fileMap.get(item.from) || "";
    const replacement = replaceWikiLinkTarget(body, item.to, wikiLinkTargetForPath(item.suggestion.path));
    if (!replacement.count || replacement.body === body) continue;
    fileMap.set(item.from, replacement.body);
    state.dreamDismissedBrokenLinks.delete(dreamBrokenLinkKey(item.from, item.to));
    repairs.push({
      from: item.from,
      fromTitle: item.fromTitle,
      broken: item.to,
      targetPath: item.suggestion.path,
      targetTitle: item.suggestion.title
    });
  }
  if (repairs.length) {
    state.hasUnsavedEdits = true;
    state.pendingSave = false;
  }
  return repairs;
}

// dreamBrokenLinkKey → core/dream-stats.js

function approveDreamBrokenLink(fromPath, brokenTarget, targetPath) {
  const normalizedFrom = normalizeMarginsPath(fromPath || "");
  const normalizedTarget = normalizeMarginsPath(targetPath || "");
  if (!normalizedFrom || !brokenTarget || !normalizedTarget) return false;
  const activeMap = activeActivityFileMap();
  if (!activeMap?.has(normalizedFrom) || !activeMap?.has(normalizedTarget)) return false;
  const fileMap = state.currentFileMap || new Map(activeMap);
  state.currentFileMap = fileMap;
  const currentBody = fileMap.get(normalizedFrom) || "";
  const replacement = replaceWikiLinkTarget(currentBody, brokenTarget, wikiLinkTargetForPath(normalizedTarget));
  if (!replacement.count || replacement.body === currentBody) return false;
  fileMap.set(normalizedFrom, replacement.body);
  state.dreamDismissedBrokenLinks.delete(dreamBrokenLinkKey(normalizedFrom, brokenTarget));
  state.hasUnsavedEdits = true;
  state.pendingSave = false;
  if (state.selectedPath === normalizedFrom) selectVaultPath(normalizedFrom, { preserveFocus: true });
  renderVaultTree(fileMap);
  renderWikiFiles(fileMap);
  renderOperatingLayer(fileMap);
  drawGraph(graphFromFileMap(fileMap));
  updateSaveButtonState();
  return true;
}

function replaceWikiLinkTarget(body, brokenTarget, nextTarget) {
  const oldTarget = cleanWikiLinkLabel(brokenTarget);
  const cleanNext = cleanWikiLinkLabel(nextTarget);
  if (!oldTarget || !cleanNext) return { body, count: 0 };
  let count = 0;
  const pattern = new RegExp(`\\[\\[\\s*${escapeRegExp(oldTarget)}(#[^\\]|]+)?(\\|[^\\]]+)?\\s*\\]\\]`, "gi");
  const nextBody = String(body || "").replace(pattern, (_match, section = "", alias = "") => {
    count += 1;
    return `[[${cleanNext}${section || ""}${alias || ""}]]`;
  });
  return { body: nextBody, count };
}

// wikiLinkTargetForPath → core/dream-stats.js

async function runPreparedDreamHelper() {
  const prepared = state.dreamPreparedRun;
  const fileMap = activeActivityFileMap();
  if (!prepared || !fileMap?.size || prepared.running) return;
  const stats = dreamVaultStats(fileMap);
  const item = dreamRepairItems(stats).find((entry) => entry.id === prepared.itemId);
  if (!item || item.disabled) return;
  const run = buildDreamPreparedRun(item, stats, fileMap, prepared.limits);
  if (!state.apiSecret) {
    state.dreamPreparedRun = { ...run, status: "Gemini key required. Save a Gemini API key in Advanced settings before running this batch." };
    renderDreamPreparedRunPanel(fileMap, dreamReport(fileMap));
    return;
  }
  if (run.estimate.estimatedUsd > run.limits.maxUsd) {
    state.dreamPreparedRun = { ...run, status: `Estimated cost ${formatUsd(run.estimate.estimatedUsd)} is above the ${formatUsd(run.limits.maxUsd)} hard stop.` };
    renderDreamPreparedRunPanel(fileMap, dreamReport(fileMap));
    return;
  }

  state.dreamPreparedRun = { ...run, running: true, status: "Calling Gemini with the bounded batch..." };
  renderDreamPreparedRunPanel(fileMap, dreamReport(fileMap));
  try {
    const content = await generateDreamHelperContent(run, item, fileMap);
    showDreamHelperOutput(content, item.title, "Gemini");
    state.dreamPreparedRun = null;
  } catch (error) {
    state.dreamPreparedRun = { ...run, status: `Gemini run failed: ${error.message || "unknown error"}` };
    renderDreamPreparedRunPanel(fileMap, dreamReport(fileMap));
  }
}

async function generateDreamHelperContent(run, item, fileMap, addStatus = null) {
  try {
    return await generateGeminiTextContent(run.estimate.model, run.prompt, dreamHelperTracking(run, item, fileMap), DREAM_HELPER_OUTPUT_TOKEN_FLOOR);
  } catch (error) {
    if (!isModelOutputTruncatedError(error)) throw error;
    const retryPrompt = buildDreamTruncationRetryPrompt(run, error);
    const retryOutputLimit = apiOutputTokenLimit(DREAM_HELPER_RETRY_OUTPUT_TOKEN_FLOOR);
    const retryInputTokens = estimateRequestInputTokens(retryPrompt, []);
    const retryUsd = estimateModelCostUsd(run.estimate.model, retryInputTokens, retryOutputLimit);
    if (run.estimate.estimatedUsd + retryUsd > run.limits.maxUsd) {
      throw dreamHelperRetryWouldExceedLimitError(error, retryUsd, run);
    }
    if (typeof addStatus === "function") {
      addStatus("Gemini output was cut off; retrying with a smaller proposal.");
    } else {
      state.dreamPreparedRun = {
        ...run,
        running: true,
        status: `Gemini output was cut off, so Margins is retrying with a smaller proposal. Retry estimate ${formatUsd(retryUsd)}.`
      };
      renderDreamPreparedRunPanel(fileMap, dreamReport(fileMap));
    }
    return generateGeminiTextContent(run.estimate.model, retryPrompt, {
      ...dreamHelperTracking(run, item, fileMap),
      retryOf: "truncated_dream_helper"
    }, DREAM_HELPER_RETRY_OUTPUT_TOKEN_FLOOR);
  }
}

function dreamHelperTracking(run, item, fileMap) {
  return {
    purpose: "dream_helper",
    fileName: item.id,
    sourceType: "dream",
    sourceScope: "vault",
    sourceMimeType: "text/plain",
    sourceSizeBytes: run.prompt.length,
    sourceTextChars: run.prompt.length,
    vaultContextFileCount: fileMap.size
  };
}

function dreamHelperRetryWouldExceedLimitError(originalError, retryUsd, run) {
  const error = new Error(`Gemini output was cut off. A smaller retry is estimated at ${formatUsd(retryUsd)}, which would exceed the ${formatUsd(run.limits.maxUsd)} hard stop. Reduce scope or raise the hard stop, then run again.`);
  error.code = "MARGINS_DREAM_RETRY_OVER_LIMIT";
  error.originalError = originalError;
  return error;
}

function buildDreamTruncationRetryPrompt(run, error) {
  const partial = truncateForPrompt(error.partialContent || "", 5000);
  return `The previous Gemini response for this Margins Dream helper was cut off before complete margins-file blocks came back.

Return a new complete, smaller response for the same task. Do not continue the cut-off text.

Strict retry rules:
- Return complete fenced \`\`\`margins-file blocks only.
- Return at most two file blocks.
- Prefer one ${DREAM_LOG_PATH} block that lists exact proposed repairs when a full file replacement would be long.
- Do not return full replacements for wiki/**/source-*.md files unless the whole file block is short enough to finish comfortably.
- Do not start any file block you cannot close.
- Keep the total response under 3,000 words.

Previous partial output excerpt:
${partial || "_No partial output was captured._"}

Original bounded task and vault context:
${run.prompt}`;
}

function showDreamHelperOutput(content, title, providerName = "Gemini") {
  activateTab("llm");
  els.llmInput.value = content;
  state.llmFiles = parseLlmFiles(content);
  state.llmSelectedPath = null;
  state.currentMaterialQuestions = [];
  state.hasSavedCurrent = false;
  state.pendingSave = false;
  state.llmPromptCopied = false;
  updateSaveButtonState();
  els.exportBtn.disabled = true;
  renderLlmReview();
  renderChangePreview();
  if (state.llmFiles.size > 0) {
    els.llmStatus.textContent = `${title} returned ${state.llmFiles.size} proposed file${state.llmFiles.size === 1 ? "" : "s"} from ${providerName}. Review before accepting.`;
  } else {
    els.llmStatus.textContent = `${title} finished without margins-file blocks. Output is left here for review.`;
    els.llmPreviewTitle.textContent = `${title} output`;
    els.llmPreviewBody.textContent = content || "No output returned.";
  }
}

function handleDreamModeChange(event) {
  const mode = event.target?.value;
  if (!Object.hasOwn(DREAM_MODES, mode)) return;
  state.dreamMode = mode;
  state.dreamReviewActive = false;
  renderDream(activeActivityFileMap());
}

function startDreamStepReview() {
  state.dreamReviewActive = true;
  state.dreamSkippedItems = new Set();
  state.dreamDismissedBrokenLinks = new Set();
  renderDream(activeActivityFileMap());
  els.dreamProposalList?.scrollIntoView({ block: "start", behavior: "smooth" });
}

function startDreamRunTicker() {
  stopDreamRunTicker();
  dreamRunTickerId = setInterval(() => {
    if (!state.dreamLastRun?.running) {
      stopDreamRunTicker();
      return;
    }
    renderDream(activeActivityFileMap());
  }, 1000);
}

function stopDreamRunTicker() {
  if (!dreamRunTickerId) return;
  clearInterval(dreamRunTickerId);
  dreamRunTickerId = 0;
}

async function runDreamMaintenance() {
  const fileMap = activeActivityFileMap();
  if (!fileMap?.size) {
    renderDream(fileMap || new Map());
    return;
  }

  const startedAt = new Date();
  const startedAtMs = Date.now();
  const mode = "hybrid";
  let workingMap = state.currentFileMap || new Map(fileMap);
  const baselineMap = new Map(workingMap);
  const steps = [];
  state.currentFileMap = workingMap;
  state.dreamSkippedItems = new Set();
  state.dreamDismissedBrokenLinks = new Set();
  const statsAtStart = dreamVaultStats(workingMap);
  state.dreamLastRun = {
    running: true,
    startedAt,
    startedAtMs,
    estimatedMs: dreamCleanupEstimateMs(statsAtStart),
    mode,
    applied: [],
    autoLinkFixCount: 0,
    deferredCount: 0,
    stageResults: {},
    steps
  };
  const addStep = (title, context) => {
    steps.push({ title, context });
    if (state.dreamLastRun) state.dreamLastRun.steps = [...steps];
    renderDream(workingMap);
  };
  startDreamRunTicker();

  addStep("Started cleanup", "Scanning existing wiki pages, processed source notes, links, entity coverage, graph shape, and the maintenance log.");

  for (const stage of DREAM_STAGES) {
    state.dreamActiveStage = stage.id;
    renderDream(workingMap);
    await sleep(120);
  }

  let statsBefore = dreamVaultStats(workingMap);
  addStep(
    "Scanned existing vault",
    `${formatStatNumber(statsBefore.graphNodeCount)} wiki page${statsBefore.graphNodeCount === 1 ? "" : "s"}, ${formatStatNumber(statsBefore.sourceCount)} processed source note${statsBefore.sourceCount === 1 ? "" : "s"}, and ${formatStatNumber(statsBefore.linkCount)} link${statsBefore.linkCount === 1 ? "" : "s"} checked.`
  );

  let autoLinkFixes = [];
  if (dreamModeRunsSafeCleanup(mode)) {
    state.dreamActiveStage = "association";
    renderDream(workingMap);
    autoLinkFixes = autoRepairDreamBrokenLinks(workingMap, statsBefore);
    if (autoLinkFixes.length) {
      statsBefore = dreamVaultStats(workingMap);
      addStep(
        "Updated obvious wikilinks",
        `${formatStatNumber(autoLinkFixes.length)} wikilink${autoLinkFixes.length === 1 ? "" : "s"} pointed to one clear existing page and were updated automatically.`
      );
    }
  }

  addStep(
    "Checked wikilinks",
    statsBefore.brokenLinkCount
      ? `${formatStatNumber(statsBefore.brokenLinkCount)} wikilink${statsBefore.brokenLinkCount === 1 ? "" : "s"} did not have one confident existing target, so Margins left them alone.`
      : "All wikilinks resolve to existing pages or aliases."
  );
  addStep(
    "Checked entity pages",
    statsBefore.sparseEntityCount
      ? `${formatStatNumber(statsBefore.sparseEntityCount)} sparse entity page${statsBefore.sparseEntityCount === 1 ? "" : "s"} need review.`
      : "No sparse entity pages found."
  );

  let lintResult = { actions: [] };
  if (dreamModeRunsSafeCleanup(mode)) {
    state.dreamActiveStage = "clearance";
    renderDream(workingMap);
    lintResult = runDreamLintCleanup(workingMap, statsBefore, autoLinkFixes);
    if (lintResult.actions.length) {
      addStep(
        "Ran /lint cleanup",
        `${formatStatNumber(lintResult.actions.length)} vault health file${lintResult.actions.length === 1 ? "" : "s"} updated for future model retrieval.`
      );
    } else {
      addStep("Ran /lint cleanup", "Vault health files were already current.");
    }
  }

  const applied = [];
  if (autoLinkFixes.length) {
    applied.push({
      id: "auto-link-repairs",
      stage: "clearance",
      title: "Updated obvious wikilinks",
      body: `${formatStatNumber(autoLinkFixes.length)} obvious link${autoLinkFixes.length === 1 ? "" : "s"} repaired to improve retrieval.`
    });
  }
  for (const action of lintResult.actions) {
    applied.push({
      id: action.id,
      stage: "clearance",
      title: action.title,
      body: action.context
    });
  }
  if (dreamModeRunsSafeCleanup(mode)) {
    state.dreamActiveStage = "clearance";
    renderDream(workingMap);
    if (state.vaultHandle && state.hasUnsavedEdits) {
      await saveCurrentVault({ afterSaveView: "dream" });
      if (state.hasUnsavedEdits || state.pendingSave) {
        addStep("Queued lint writes", "Prepared vault lint updates; use Write vault if the save did not finish.");
      } else {
        addStep("Saved lint cleanup", "Wrote lint cleanup updates to the vault.");
      }
    } else if (state.hasUnsavedEdits) {
      addStep("Queued lint writes", "Prepared lint cleanup updates; open the vault to save them.");
    }
  }

  const statsAfter = dreamVaultStats(workingMap);
  const itemsAfter = dreamRepairItems(statsAfter);
  let deferred = itemsAfter.filter((item) => item.safety === "review" && !item.disabled);
  let deepReviewFileCount = 0;
  let deepReviewOutput = "";
  if (mode === "walk") {
    const deepResult = await runDreamDeepReviewHelpers(workingMap, statsAfter, addStep);
    deepReviewFileCount = deepResult.fileCount;
    deepReviewOutput = deepResult.output;
  }
  state.dreamActiveStage = "";
  stopDreamRunTicker();
  const changedFiles = dreamChangedFilesFromRun(baselineMap, workingMap);
  const finishedAt = new Date();
  state.dreamReviewActive = mode !== "watch" && deferred.length > 0 && deepReviewFileCount === 0;
  state.dreamLastRun = {
    running: false,
    startedAt,
    startedAtMs,
    finishedAt,
    finishedAtMs: finishedAt.getTime(),
    durationMs: Math.max(0, finishedAt.getTime() - startedAtMs),
    mode,
    applied,
    changedFiles,
    linkRepairs: autoLinkFixes,
    lintActions: lintResult.actions,
    autoLinkFixCount: autoLinkFixes.length,
    deepReviewFileCount,
    deferredCount: deferred.length,
    stageResults: dreamStageResults(itemsAfter, applied),
    steps
  };

  if (deepReviewFileCount > 0) {
    showDreamDeepReviewOutput(deepReviewOutput, deepReviewFileCount);
  } else {
    activateTab("dream");
  }
  renderVaultTree(workingMap);
  renderWikiFiles(workingMap);
  renderOperatingLayer(workingMap);
  drawGraph(graphFromFileMap(workingMap));
  updateSaveButtonState();
}

function hasWritableVaultConnection() {
  return Boolean(state.vaultHandle || state.rememberedVaultHandle);
}

function dreamModeRunsSafeCleanup(mode) {
  return mode === "hybrid" || mode === "walk";
}

async function runDreamDeepReviewHelpers(fileMap, stats, addStep) {
  const helperItems = dreamRepairItems(stats).filter((item) => item.action === "dream-agent" && !item.disabled);
  if (helperItems.length === 0) {
    addStep("Deep API review", "No API review tasks are available right now.");
    return { output: "", fileCount: 0 };
  }
  if (!state.apiSecret) {
    addStep("Deep API review needs setup", "Save a Gemini API key before running API review tasks.");
    return { output: "", fileCount: 0 };
  }

  const outputs = [];
  for (const item of helperItems) {
    state.dreamActiveStage = item.stage;
    const run = buildDreamPreparedRun(item, stats, fileMap, dreamDefaultRunLimits(item.id, stats));
    if (run.estimate.estimatedUsd > run.limits.maxUsd) {
      addStep(
        item.title,
        `Skipped Gemini helper: estimated ${formatUsd(run.estimate.estimatedUsd)} is above the ${formatUsd(run.limits.maxUsd)} hard stop.`
      );
      continue;
    }
    addStep(
      item.title,
      `Running Gemini on ${dreamRunBatchDescription(item.id, run.limits, stats)}. Estimated ${formatUsd(run.estimate.estimatedUsd)} with a ${formatUsd(run.limits.maxUsd)} hard stop; returned changes will open for review before saving.`
    );
    try {
      const content = await generateDreamHelperContent(run, item, fileMap, (status) => addStep(item.title, status));
      const parsed = parseLlmFiles(content);
      outputs.push(`<!-- Dream helper: ${item.title} -->\n${content}`);
      addStep(item.title, parsed.size
        ? `Returned ${formatStatNumber(parsed.size)} proposed file${parsed.size === 1 ? "" : "s"} for review.`
        : "Finished without reviewable file blocks.");
    } catch (error) {
      addStep(item.title, `Stopped: ${error.message || "unknown error"}`);
    }
  }

  const output = outputs.join("\n\n").trim();
  return {
    output,
    fileCount: parseLlmFiles(output).size
  };
}

function showDreamDeepReviewOutput(output, fileCount) {
  els.llmInput.value = output;
  state.llmFiles = parseLlmFiles(output);
  state.llmSelectedPath = null;
  state.currentMaterialQuestions = [];
  state.hasSavedCurrent = false;
  state.pendingSave = false;
  state.llmPromptCopied = false;
  updateSaveButtonState();
  els.exportBtn.disabled = true;
  activateTab("llm");
  renderLlmReview();
  renderChangePreview();
  els.llmPreviewTitle.textContent = "Deep API review output";
  if (fileCount > 0) {
    els.llmStatus.textContent = `Deep API review returned ${formatStatNumber(fileCount)} proposed file${fileCount === 1 ? "" : "s"}. Review before accepting.`;
  }
}

function runDreamLintCleanup(fileMap, stats, linkRepairs = []) {
  if (!fileMap?.size) return { actions: [] };
  const today = localDateString();
  const actions = [];
  const statsBody = buildDreamLintStatsFile(fileMap, stats, today, linkRepairs);
  if ((fileMap.get("wiki/wiki-stats.md") || "") !== statsBody) {
    fileMap.set("wiki/wiki-stats.md", statsBody);
    actions.push({
      id: "lint-wiki-stats",
      title: "Updated wiki stats",
      file: "wiki/wiki-stats.md",
      context: "Refreshed /lint health counts for graph shape, unmatched wikilinks, sparse pages, and large source notes."
    });
  }

  const logBody = buildDreamLintLogFile(fileMap.get("wiki/log.md") || "", stats, actions, today);
  if ((fileMap.get("wiki/log.md") || "") !== logBody) {
    fileMap.set("wiki/log.md", logBody);
    actions.push({
      id: "lint-log",
      title: "Recorded lint pass",
      file: "wiki/log.md",
      context: "Added a /lint operation entry so future model runs can see what cleanup changed."
    });
  }
  const finalStats = dreamVaultStats(fileMap);
  const finalStatsBody = buildDreamLintStatsFile(fileMap, finalStats, today, linkRepairs);
  if ((fileMap.get("wiki/wiki-stats.md") || "") !== finalStatsBody) {
    fileMap.set("wiki/wiki-stats.md", finalStatsBody);
    if (!actions.some((action) => action.id === "lint-wiki-stats")) {
      actions.unshift({
        id: "lint-wiki-stats",
        title: "Updated wiki stats",
        file: "wiki/wiki-stats.md",
        context: "Refreshed /lint health counts for graph shape, unmatched wikilinks, sparse pages, and large source notes."
      });
    }
  }

  if (actions.length) {
    state.hasUnsavedEdits = true;
    state.pendingSave = false;
  }
  return { actions };
}

function buildDreamLintStatsFile(fileMap, stats, today, linkRepairs = []) {
  const existingFields = frontmatterFields(fileMap.get("wiki/wiki-stats.md") || "");
  const created = existingFields.created || today;
  const sourceRecords = recentActivityRecords(fileMap);
  const sparsePages = (stats.sparseEntities || []).map((entry) => entry.path);
  const missingSummaries = dreamLintMissingSummaryPages(fileMap);
  const orphanPages = dreamLintOrphanPages(fileMap);
  const largeSources = sourceRecords
    .slice()
    .sort((left, right) => right.wordTotal - left.wordTotal || left.path.localeCompare(right.path))
    .slice(0, 8);
  return `---
type: dashboard
bucket: system
summary: Structural health dashboard for this Margins vault.
tags: [stats, lint, drift, system]
created: ${created}
updated: ${today}
voice: claude-draft
---

# Wiki Stats

Generated: ${today}

## Shape

- Wiki pages: ${formatStatNumber(stats.graphNodeCount)}
- Source notes: ${formatStatNumber(stats.sourceCount)}
- Concept pages: ${formatStatNumber(stats.conceptCount)}
- Entity/project pages: ${formatStatNumber(stats.entityCount)}
- Synthesis pages: ${formatStatNumber(stats.synthesisCount)}
- Graph links: ${formatStatNumber(stats.linkCount)}

## Retrieval Health

- Obvious wikilinks updated this run: ${formatStatNumber(linkRepairs.length)}
- Unmatched wikilinks left alone: ${formatStatNumber(stats.brokenLinkCount)}
- Sparse entity/project pages: ${formatStatNumber(stats.sparseEntityCount)}
- Pages missing summaries: ${formatStatNumber(missingSummaries.length)}
- Orphan pages: ${formatStatNumber(orphanPages.length)}

## Unmatched Wikilinks

${dreamLintBrokenLinkLines(stats.brokenLinks)}

## Sparse Pages

${sparsePages.slice(0, 12).map((path) => `- \`${path}\``).join("\n") || "- _(none)_"}

## Missing Summaries

${missingSummaries.slice(0, 12).map((path) => `- \`${path}\``).join("\n") || "- _(none)_"}

## Largest Source Notes

${largeSources.map((record) => `- \`${record.path}\` - ${formatStatNumber(record.wordTotal)} words`).join("\n") || "- _(none)_"}

## /lint Notes

- Dream cleanup scans existing vault notes only; pending uploads stay in Activity and Bulk upload.
- Safe automatic writes update clear wikilinks, this stats dashboard, and the operation log.
- Review-heavy fixes should stay as proposals until the user approves them.
`;
}

function buildDreamLintLogFile(existingBody, stats, actions, today) {
  const base = existingBody.trim() || `---
type: log
bucket: system
summary: Human-readable operation log for this Margins vault.
tags: [log, operations, system]
created: ${today}
updated: ${today}
voice: claude-draft
---

# Log

Allowed ops: ingest | query | compile | lint | update
`;
  const actionLines = actions.length
    ? actions.map((action) => `- Updated \`${action.file}\`: ${action.context}`).join("\n")
    : "- No health files needed updates before this log entry.";
  const entry = `## [${today}] lint

- Scanned ${formatStatNumber(stats.graphNodeCount)} wiki page${stats.graphNodeCount === 1 ? "" : "s"}, ${formatStatNumber(stats.sourceCount)} processed source note${stats.sourceCount === 1 ? "" : "s"}, and ${formatStatNumber(stats.linkCount)} wikilink${stats.linkCount === 1 ? "" : "s"}.
- Left ${formatStatNumber(stats.brokenLinkCount)} unmatched wikilink${stats.brokenLinkCount === 1 ? "" : "s"} alone when no confident target existed.
- Flagged ${formatStatNumber(stats.sparseEntityCount)} sparse entity/project page${stats.sparseEntityCount === 1 ? "" : "s"} for review.
${actionLines}`;
  return `${base}\n\n${entry}\n`;
}

function dreamLintMissingSummaryPages(fileMap) {
  return [...fileMap.entries()]
    .filter(([path, body]) => isDreamLintContentPage(path, body))
    .filter(([, body]) => !cleanSummary(frontmatterFields(body).summary || ""))
    .map(([path]) => path)
    .sort((left, right) => left.localeCompare(right));
}

function dreamLintOrphanPages(fileMap) {
  const incoming = new Map();
  const outgoing = new Map();
  const pagePaths = new Set([...fileMap.keys()].filter((path) => isDreamLintContentPage(path, fileMap.get(path))));
  for (const path of pagePaths) {
    incoming.set(path, 0);
    outgoing.set(path, 0);
  }
  for (const path of pagePaths) {
    const links = extractWikiLinks(fileMap.get(path) || "");
    for (const link of links) {
      const targetPath = pathForWikiLinkLabel(link, fileMap);
      if (!targetPath || !pagePaths.has(targetPath)) continue;
      outgoing.set(path, (outgoing.get(path) || 0) + 1);
      incoming.set(targetPath, (incoming.get(targetPath) || 0) + 1);
    }
  }
  return [...pagePaths]
    .filter((path) => path !== "wiki/index.md" && !isActivitySourcePagePath(path, fileMap.get(path) || ""))
    .filter((path) => (incoming.get(path) || 0) === 0 && (outgoing.get(path) || 0) === 0)
    .sort((left, right) => left.localeCompare(right));
}

function isDreamLintContentPage(path, body = "") {
  if (!path.startsWith("wiki/") || !path.endsWith(".md")) return false;
  if (path.startsWith("wiki/.margins/") || path.startsWith("wiki/_templates/")) return false;
  if (/^wiki\/(log|wiki-stats|ingest-tracker)\.md$/.test(path)) return false;
  if (isBucketOverviewPath(path) || isFolderIndexPath(path)) return false;
  const type = normalizeEntityTag(frontmatterFields(body).type || "");
  return Boolean(type) || /^wiki\/(sources|concepts|entities|projects|synthesis|personal|career|ideas|school|coding|finance)\//.test(path);
}

function dreamLintBrokenLinkLines(links = []) {
  const visible = links.slice(0, 12);
  const lines = visible.map((link) => `- \`${link.from}\` has \`[[${link.to}]]\``);
  const extraCount = Math.max(0, links.length - visible.length);
  if (extraCount) lines.push(`- ...and ${formatStatNumber(extraCount)} more.`);
  return lines.join("\n") || "- _(none)_";
}

function dreamStageResults(items = [], applied = []) {
  const results = {};
  for (const stage of DREAM_STAGES) {
    const stageItems = items.filter((item) => item.stage === stage.id && !item.disabled);
    const stageApplied = applied.filter((item) => item.stage === stage.id);
    results[stage.id] = {
      queued: stageItems.length,
      applied: stageApplied.length,
      deferred: stageItems.filter((item) => item.safety === "review").length
    };
  }
  return results;
}

function handleDreamActionClick(event) {
  const button = event.target.closest("[data-dream-action]");
  if (!button || !els.dreamProposalList?.contains(button)) return;
  event.preventDefault();
  void openDreamAction(button.dataset.dreamAction, button.dataset.dreamTarget);
}

async function openDreamAction(action, target = "") {
  if (action === "run-maintenance") {
    withBusyOperation("maintenance pass", runDreamMaintenance);
    return;
  }
  if (action === "dream-agent") {
    prepareDreamHelperRun(target);
    return;
  }
  if (action === "skip-dream-item") {
    if (target) state.dreamSkippedItems.add(target);
    renderDream(activeActivityFileMap());
    return;
  }
  if (action === "open-file") {
    activateTab("wiki");
    if (target) selectVaultPath(target);
    return;
  }
  if (action === "review-entities") {
    activateTab("entities");
    els.entitySearch?.focus({ preventScroll: true });
    return;
  }
  if (action === "open-graph") {
    activateTab("graph");
    return;
  }
  if (action === "open-activity") {
    activateTab("inbox");
    els.recentActivityPanel?.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  activateTab("wiki");
}

async function runDreamCleanupHelper(itemId) {
  const fileMap = activeActivityFileMap();
  if (!fileMap?.size) return;
  const stats = dreamVaultStats(fileMap);
  const item = dreamRepairItems(stats).find((entry) => entry.id === itemId);
  if (!item) return;
  const prompt = buildDreamCleanupPrompt(item, stats, fileMap);
  const provider = els.apiProvider?.value || providerValue(state.apiSettings.providerLabel) || "gemini";
  const model = els.apiModel?.value.trim() || defaultModelForProvider(provider);
  activateTab("llm");
  els.llmInput.value = "";
  state.llmFiles = new Map();
  state.llmSelectedPath = null;
  state.currentMaterialQuestions = [];
  els.llmFileList.className = "tree-list empty";
  els.llmFileList.textContent = "Waiting for Dream helper output.";
  els.acceptLlmBtn.disabled = true;
  els.repairLlmBtn.disabled = true;
  els.llmInput.placeholder = "Dream helper output will appear here as margins-file blocks.";
  els.llmStatus.textContent = `Running ${item.title} helper with ${providerLabel(provider)}...`;
  els.llmPreviewTitle.textContent = `${item.title} helper`;
  els.llmPreviewBody.textContent = "Dream helpers return margins-file blocks here. Review parsed files before accepting them into the vault.";
  els.llmInput.focus();
  if (apiProviderRequiresSecret(provider) && !state.apiSecret) {
    els.llmStatus.textContent = `API key required. Save a ${providerLabel(provider)} key before running ${item.title}.`;
    els.llmPreviewTitle.textContent = `${item.title} helper not started`;
    els.llmPreviewBody.textContent = "Dream helpers now run through the configured API. Add an API key in Advanced settings, or switch Provider to Local model if you are using a local OpenAI-compatible endpoint.";
    els.llmFileList.textContent = "No helper output yet.";
    updateWorkflowState();
    return;
  }
  try {
    const content = await generateApiTextContent(provider, model, prompt, {
      purpose: "dream_helper",
      fileName: item.id,
      sourceType: "dream",
      sourceScope: "vault",
      sourceMimeType: "text/plain",
      sourceSizeBytes: prompt.length,
      sourceTextChars: prompt.length,
      vaultContextFileCount: fileMap.size
    }, DREAM_HELPER_OUTPUT_TOKEN_FLOOR);
    els.llmInput.value = content;
    state.llmFiles = parseLlmFiles(content);
    state.hasSavedCurrent = false;
    state.pendingSave = false;
    state.llmPromptCopied = false;
    updateSaveButtonState();
    els.exportBtn.disabled = true;
    renderLlmReview();
    renderChangePreview();
    if (state.llmFiles.size > 0) {
      els.llmStatus.textContent = `${item.title} helper returned ${state.llmFiles.size} file${state.llmFiles.size === 1 ? "" : "s"}. Review before accepting.`;
    } else {
      els.llmStatus.textContent = `${item.title} helper finished without margins-file blocks. Output is left here for review.`;
      els.llmPreviewTitle.textContent = `${item.title} helper output`;
      els.llmPreviewBody.textContent = content || "No output returned.";
      updateWorkflowState();
    }
  } catch (error) {
    els.llmStatus.textContent = `${item.title} helper failed: ${error.message || "unknown error"}`;
    els.llmPreviewTitle.textContent = `${item.title} helper failed`;
    els.llmPreviewBody.textContent = "The prompt is still available from Dream. Check API key, provider, model, and spend guard settings before retrying.";
    updateWorkflowState();
  }
}

function dreamReport(fileMap) {
  const stats = dreamVaultStats(fileMap);
  const connected = fileMap.size > 0;
  const sourceLabel = `${formatStatNumber(stats.sourceCount)} source note${stats.sourceCount === 1 ? "" : "s"}`;
  const queueItems = connected ? dreamRepairItems(stats) : [];
  const reviewItemCount = queueItems.filter((item) => item.safety === "review" && !item.disabled && !state.dreamSkippedItems.has(item.id)).length;
  const safeFixCount = queueItems.filter((item) => item.safety === "auto" && !item.disabled).length;
  const operations = dreamOperations(stats, connected, queueItems);
  const lastRun = state.dreamLastRun;
  return {
    connected,
    meta: connected
      ? `${sourceLabel} · ${formatStatNumber(stats.linkCount)} links · ${formatStatNumber(stats.graphNodeCount)} pages scanned`
      : "Open a vault to see what needs attention.",
    title: connected
      ? lastRun?.running
        ? "Cleaning vault"
        : state.dreamReviewActive
          ? "Review important changes"
          : "Ready to clean"
      : "Open a vault to see suggested next actions",
    body: connected
      ? "Margins scans existing vault notes for link, entity, and structure issues that make model retrieval weaker."
      : "Open a vault to surface maintenance items.",
    passStatus: dreamPassStatus(connected, reviewItemCount, safeFixCount),
    operations,
    queueItems,
    reviewItemCount,
    emptyQueueText: connected
      ? "Everything Margins found was safe to handle automatically, or low-value enough to leave alone."
      : "Open a vault. Retrieval cleanup will turn into concrete next actions here.",
    logEntries: connected ? dreamLogEntries(stats, lastRun) : [],
    log: lastRun?.running
      ? "Cleanup activity is updating as Margins scans existing vault notes."
      : lastRun
        ? "Cleanup activity: each row shows one check or change."
        : stats.hasDreamLog
          ? "Loaded wiki/.margins/dream-log.md."
          : "Run cleanup to see a plain activity log of checks and changes."
  };
}

function dreamPassStatus(connected, reviewItemCount, safeFixCount) {
  if (!connected) return "Open a vault before running maintenance.";
  if (state.dreamLastRun?.running) {
    return dreamRunningStatus();
  }
  if (state.dreamLastRun) {
    const appliedCount = state.dreamLastRun.applied?.length || 0;
    const changedFileCount = state.dreamLastRun.changedFiles?.length || 0;
    const deepCount = state.dreamLastRun.deepReviewFileCount || 0;
    const autoLinkCount = state.dreamLastRun.autoLinkFixCount || 0;
    const durationText = state.dreamLastRun.durationMs
      ? ` in ${formatDreamRunDuration(state.dreamLastRun.durationMs)}`
      : "";
    const changedText = `${formatStatNumber(changedFileCount)} file${changedFileCount === 1 ? "" : "s"} changed, `;
    const deepText = deepCount
      ? `${formatStatNumber(deepCount)} proposed file${deepCount === 1 ? "" : "s"} opened for review, `
      : "";
    const linkText = autoLinkCount
      ? `${formatStatNumber(autoLinkCount)} obvious wikilink${autoLinkCount === 1 ? "" : "s"} updated, `
      : "";
    return `Cleanup finished${durationText}: ${changedText}${linkText}${deepText}${formatStatNumber(appliedCount)} safe update${appliedCount === 1 ? "" : "s"} handled, ${formatStatNumber(state.dreamLastRun.deferredCount)} risky item${state.dreamLastRun.deferredCount === 1 ? "" : "s"} left for review.`;
  }
  return `Ready to clean: ${formatStatNumber(safeFixCount)} automatic check${safeFixCount === 1 ? "" : "s"} available, ${formatStatNumber(reviewItemCount)} risky call${reviewItemCount === 1 ? "" : "s"} may need review.`;
}

function dreamRunningStatus() {
  const lastRun = state.dreamLastRun || {};
  const parsedStartedAtMs = Number(lastRun.startedAtMs) || (lastRun.startedAt ? new Date(lastRun.startedAt).getTime() : Date.now());
  const startedAtMs = Number.isFinite(parsedStartedAtMs) ? parsedStartedAtMs : Date.now();
  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const estimateMs = Math.max(1000, Number(lastRun.estimatedMs) || 8000);
  const remainingMs = Math.max(0, estimateMs - elapsedMs);
  const stageIndex = DREAM_STAGES.findIndex((stage) => stage.id === state.dreamActiveStage);
  const stepText = stageIndex >= 0
    ? `Step ${stageIndex + 1} of ${DREAM_STAGES.length}`
    : "Finalizing";
  const timingText = elapsedMs >= estimateMs
    ? `${formatDreamRunDuration(elapsedMs)} elapsed, wrapping up`
    : `${formatDreamRunDuration(elapsedMs)} elapsed, about ${formatDreamRunDuration(remainingMs)} left`;
  return `Cleaning ${dreamStageName(state.dreamActiveStage)}. ${stepText}. ${timingText}. Scanning existing wiki notes only.`;
}

// dreamCleanupEstimateMs, formatDreamRunDuration, dreamChangedFilesFromRun → core/dream-stats.js

function dreamVaultStats(fileMap) {
  const entries = [...(fileMap || new Map()).entries()];
  const sourcePages = entries.filter(([path, body]) => isActivitySourcePagePath(path, body));
  const conceptPages = entries.filter(([path, body]) => dreamPageType(path, body) === "concept");
  const entityPages = entries.filter(([path, body]) => dreamPageType(path, body) === "entity");
  const synthesisPages = entries.filter(([path, body]) => dreamPageType(path, body) === "synthesis");
  const graph = dreamGraphStats(fileMap || new Map());
  const brokenLinks = dreamBrokenLinks(fileMap || new Map())
    .filter((link) => !state.dreamDismissedBrokenLinks.has(dreamBrokenLinkKey(link.from, link.to)));
  const sparseEntities = entityPages.filter(([, body]) => {
    const fields = frontmatterFields(body);
    return !cleanSummary(fields.summary || "") || bodyWithoutFrontmatter(body).length < 220;
  });
  const operatingFileCount = entries.filter(([path]) => isOperatingBrowserPath(path)).length;
  return {
    sourceCount: sourcePages.length,
    conceptCount: conceptPages.length,
    entityCount: entityPages.length,
    synthesisCount: synthesisPages.length,
    linkCount: graph.edges.length,
    graphNodeCount: graph.nodes.length,
    brokenLinkCount: brokenLinks.length,
    brokenLinks,
    sparseEntityCount: sparseEntities.length,
    sparseEntities: sparseEntities.map(([path, body]) => ({ path, body })),
    operatingFileCount,
    hasDreamLog: fileMap?.has(DREAM_LOG_PATH) || false
  };
}

// dreamPageType, dreamBrokenLinks, isDreamBrokenLinkScanPath,
// isDreamPlaceholderLink, dreamGraphStats → core/dream-stats.js

function dreamOperations(stats, connected, items = []) {
  const lastResults = state.dreamLastRun?.stageResults || {};
  return DREAM_STAGES.map((stage) => {
    const stageItems = items.filter((item) => item.stage === stage.id && !item.disabled);
    const applied = lastResults[stage.id]?.applied || 0;
    const deferred = stageItems.filter((item) => item.safety === "review").length;
    const queued = connected ? stageItems.length : 0;
    const active = state.dreamActiveStage === stage.id;
    const stateName = !connected
      ? "idle"
      : active
        ? "active"
        : applied
          ? "done"
          : deferred
            ? "warn"
            : queued
              ? ""
              : "idle";
    return {
      ...stage,
      active,
      queued,
      applied,
      deferred,
      state: stateName,
      metric: connected ? dreamStageMetric(queued, applied, deferred) : "idle"
    };
  });
}

// dreamStageMetric → core/dream-stats.js

// dreamRepairItems → core/dream-stats.js

function dreamLogEntries(stats, lastRun = null) {
  if (lastRun?.running) {
    const runSteps = Array.isArray(lastRun.steps) ? lastRun.steps : [];
    return runSteps.slice(-6).map((step) => ({
      kind: "working",
      title: step.title || "Working",
      context: step.context || ""
    }));
  }
  if (lastRun) return dreamCompletedActivityEntries(stats, lastRun);
  return [
    {
      kind: "scan",
      title: "Ready to scan existing vault",
      context: `${formatStatNumber(stats.graphNodeCount)} wiki page${stats.graphNodeCount === 1 ? "" : "s"}, ${formatStatNumber(stats.sourceCount)} processed source note${stats.sourceCount === 1 ? "" : "s"}, and ${formatStatNumber(stats.linkCount)} link${stats.linkCount === 1 ? "" : "s"} visible. Pending uploads stay in Activity.`
    },
    {
      kind: "scan",
      title: "Retrieval checks prepared",
      context: "Margins will look for obvious wikilink repairs, thin entity pages, source-backed backlinks, and synthesis opportunities."
    }
  ];
}

function dreamCompletedActivityEntries(stats, lastRun = null) {
  const linkRepairs = Array.isArray(lastRun.linkRepairs) ? lastRun.linkRepairs : [];
  const lintActions = Array.isArray(lastRun.lintActions) ? lastRun.lintActions : [];
  const changedFiles = Array.isArray(lastRun.changedFiles) ? lastRun.changedFiles : [];
  const linkFiles = new Set(linkRepairs.map((repair) => normalizeMarginsPath(repair.from)));
  const entries = linkRepairs.map((repair) => ({
    kind: "changed",
    title: "Updated wikilink",
    file: repair.from,
    broken: repair.broken,
    changedTo: wikiLinkTargetForPath(repair.targetPath)
  }));
  for (const action of lintActions) {
    entries.push({
      kind: "changed",
      title: action.title,
      file: action.file,
      context: action.context
    });
  }
  const lintFiles = new Set(lintActions.map((action) => normalizeMarginsPath(action.file)));
  const otherChangedFiles = changedFiles.filter((file) => (
    file.path !== DREAM_LOG_PATH &&
    !linkFiles.has(normalizeMarginsPath(file.path)) &&
    !lintFiles.has(normalizeMarginsPath(file.path))
  ));
  for (const file of otherChangedFiles.slice(0, 4)) {
    entries.push({
      kind: "changed",
      title: file.kind === "added" ? "Created file" : file.kind === "removed" ? "Removed file" : "Updated file",
      context: `${file.path} (${file.kind})`
    });
  }
  if (changedFiles.some((file) => file.path === DREAM_LOG_PATH)) {
    entries.push({
      kind: "changed",
      title: "Recorded cleanup note",
      context: DREAM_LOG_PATH
    });
  }
  if (stats.brokenLinkCount) {
    entries.push(...dreamUnmatchedLinkEntries(stats.brokenLinks));
  }
  if (!entries.length) {
    entries.push({
      kind: "scan",
      title: "No automatic changes",
      context: `${formatStatNumber(stats.graphNodeCount)} wiki page${stats.graphNodeCount === 1 ? "" : "s"} scanned. Nothing had one clear low-risk fix.`
    });
  }
  entries.push({
    kind: "scan",
    title: "Scanned existing vault",
    context: `${formatStatNumber(stats.graphNodeCount)} wiki page${stats.graphNodeCount === 1 ? "" : "s"}, ${formatStatNumber(stats.sourceCount)} processed source note${stats.sourceCount === 1 ? "" : "s"}, and ${formatStatNumber(stats.linkCount)} link${stats.linkCount === 1 ? "" : "s"} checked. Pending uploads were not processed.`
  });
  const deferredCount = lastRun.deferredCount || 0;
  if (deferredCount) {
    entries.push({
      kind: "review",
      title: "Needs your call",
      context: `${formatStatNumber(deferredCount)} retrieval cleanup item${deferredCount === 1 ? "" : "s"} need review before Margins changes files.`
    });
  }
  return entries.slice(0, 14);
}

// dreamUnmatchedLinkEntries, dreamStageName → core/dream-stats.js

function formatDreamModeLabel(mode) {
  return DREAM_MODES[mode]?.label || DREAM_MODES.hybrid.label;
}

function dreamModeHelpText(mode) {
  return DREAM_MODES[mode]?.help || DREAM_MODES.hybrid.help;
}

function buildDreamCleanupPrompt(item, stats, fileMap, limits = {}) {
  const stage = DREAM_STAGES.find((entry) => entry.id === item.stage);
  const task = dreamCleanupTask(item, stats);
  const context = dreamCleanupContext(item, stats, fileMap, limits);
  const guardrails = operatingContextForPrompt(fileMap);
  const agentContext = dreamAgentContext(item, fileMap);
  return `You are running a Margins cleanup helper.

Helper: ${item.title}
Stage: ${stage?.name || item.stage} - ${stage?.label || ""}

Goal:
Clean up this bounded batch from a local-first Margins vault with conservative, source-grounded edits. Return only files that should be created or replaced. Do not return unchanged files.

Hard rules:
- Read the provided context before proposing changes.
- Do not delete notes.
- Do not rename important pages unless the task explicitly asks for a rename proposal.
- Do not invent facts, relationships, dates, roles, or summaries.
- If a change requires judgment, write it as a proposal in the relevant file or in ${DREAM_LOG_PATH}; do not silently apply it.
- Keep citations durable: wiki links, source page links, filenames in raw/, and plain section names only.
- No ChatGPT-only citation artifacts, hidden attachment ids, turn ids, or contentReference tokens.
- Every returned wiki markdown page must keep valid YAML frontmatter if it already has it.
- Preserve the user's wording unless a structural cleanup requires a small edit.
- Keep output compact and complete. A small review note is better than a large truncated rewrite.
- Return at most four changed files.
- Do not return full replacements for long source notes such as wiki/**/source-*.md. If fixing that file would require a large replacement, return ${DREAM_LOG_PATH} with exact proposed link repairs instead.

Operating guardrails:
${guardrails}

Relevant local agent guidance:
${agentContext}

Task:
${task}

Batch limits:
- Max items: ${formatStatNumber(limits.maxItems || 0)}
- Max files/pages: ${formatStatNumber(limits.maxFiles || 0)}
- Only use the vault context below. Do not ask for or assume access to the rest of the vault.

Output format:
Return Markdown files in this exact fenced-block format so Margins can parse and review them:

\`\`\`margins-file path="wiki/example.md"
Full replacement file body here.
\`\`\`

Return one fenced block per changed file. If nothing is safe to change, return one ${DREAM_LOG_PATH} block explaining what you checked and what needs Connor's judgment.
Do not start a margins-file block unless you can close it completely. Keep each returned file block under 5,000 words.

Vault context:
${context}`;
}

function dreamAgentContext(item, fileMap) {
  const paths = dreamAgentPathsForItem(item?.id || "");
  if (!paths.length) return "- No specialized local agent guidance found for this helper.";
  return paths.map((path) => {
    const body = fileMap.get(path);
    return body ? `- ${path}\n${excerptForQuestion(body, 700)}` : "";
  }).filter(Boolean).join("\n\n") || "- No specialized local agent guidance found for this helper.";
}

function dreamAgentPathsForItem(itemId) {
  if (itemId === "clearance-broken-links") return ["agents/wiki-editor.md", "agents/source-auditor.md"];
  if (itemId === "pruning-sparse-entities") return ["agents/wiki-editor.md", "agents/source-auditor.md"];
  if (itemId === "association-source-links") return ["agents/wiki-compiler.md", "agents/wiki-editor.md", "agents/source-auditor.md"];
  if (itemId === "synthesis-cross-source") return ["agents/wiki-compiler.md", "agents/source-auditor.md"];
  return [];
}

function dreamCleanupTask(item, stats) {
  if (item.id === "clearance-broken-links") {
    return `Repair broken wiki links.
- For each broken link, inspect the affected file and the vault path catalog.
- If there is one obvious existing target, replace the link with that exact wiki link.
- If multiple targets are plausible, leave the original link and add a short "Needs review" note instead.
- Do not create stub pages just to silence a broken link.
- When Margins provides snippets instead of a complete file, do not return that file as a replacement. Return ${DREAM_LOG_PATH} with exact proposed repairs instead.
- Return only affected files and, if useful, ${DREAM_LOG_PATH}.`;
  }
  if (item.id === "pruning-sparse-entities") {
    return `Improve sparse entity pages.
- Add or tighten summaries only when the provided source/entity context directly supports them.
- Add source backlinks where support is visible.
- If an entity looks like a duplicate or weak stub, add a review note rather than merging or deleting it.
- Return only sparse entity files that can be improved and, if useful, ${DREAM_LOG_PATH}.`;
  }
  if (item.id === "association-source-links") {
    return `Strengthen source-supported associations.
- Compare the provided source notes and existing entity/concept pages.
- Add backlinks only when two pages explicitly refer to the same durable person, company, project, concept, or source-supported event.
- Prefer a short "Related pages" section over broad keyword linking.
- Return only files that gain useful source-supported links.`;
  }
  if (item.id === "synthesis-cross-source") {
    return `Propose one cross-source synthesis if the sources support it.
- Look for a recurring pattern across at least two source notes.
- If the pattern is strong, return a concise wiki/synthesis/*.md draft with frontmatter, supporting source links, and explicit caveats.
- If the pattern is weak, return ${DREAM_LOG_PATH} with "No synthesis created" and the reason.
- Do not turn speculation into fact.`;
  }
  return `Review this maintenance item: ${item.title}. Return only safe, source-grounded file changes.`;
}

function dreamCleanupContext(item, stats, fileMap, limits = {}) {
  if (item.id === "clearance-broken-links") {
    const batch = dreamBrokenLinkBatch(stats, fileMap, limits);
    const linkList = batch.links.map((link) => `- ${link.from} -> [[${link.to}]]`).join("\n") || "- none";
    const skippedCount = Math.max(0, (stats.brokenLinkCount || 0) - batch.links.length);
    return [
      `Broken links in this batch:\n${linkList}`,
      `Not included in this batch: ${formatStatNumber(skippedCount)} broken link${skippedCount === 1 ? "" : "s"}. Use another run for the next batch.`,
      `Affected file sizes:\n${dreamBrokenLinkFileSizeList(batch, fileMap)}`,
      `Existing wiki path catalog:\n${dreamWikiPathCatalog(fileMap)}`,
      `Affected file context:\n${dreamBrokenLinkContextBlocks(batch, fileMap)}`
    ].join("\n\n");
  }

  if (item.id === "pruning-sparse-entities") {
    const maxEntities = positiveInteger(limits.maxItems, 12);
    const maxSources = positiveInteger(limits.maxFiles, 8);
    const entityPaths = (stats.sparseEntities || []).map((entry) => entry.path).slice(0, maxEntities);
    const sourcePaths = recentActivityRecords(fileMap).slice(0, maxSources).map((record) => record.path);
    return [
      `Sparse entity files:\n${entityPaths.map((path) => `- ${path}`).join("\n") || "- none"}`,
      `Entity files:\n${dreamFileBlocksForPaths(entityPaths, fileMap, 2400)}`,
      `Recent source context:\n${dreamFileBlocksForPaths(sourcePaths, fileMap, 1500)}`
    ].join("\n\n");
  }

  if (item.id === "association-source-links") {
    const maxSources = positiveInteger(limits.maxItems, 10);
    const maxPages = positiveInteger(limits.maxFiles, 24);
    const sourcePaths = recentActivityRecords(fileMap).slice(0, maxSources).map((record) => record.path);
    const durablePaths = wikiContextRecords(fileMap)
      .filter((record) => ["entity", "concept", "project", "synthesis"].includes(String(record.type || "").toLowerCase()) || /wiki\/(entities|concepts|projects|synthesis)\//.test(record.path))
      .slice(0, maxPages)
      .map((record) => record.path);
    return [
      `Source notes to compare:\n${dreamFileBlocksForPaths(sourcePaths, fileMap, 1600)}`,
      `Durable pages available for links:\n${dreamFileBlocksForPaths(durablePaths, fileMap, 1000)}`
    ].join("\n\n");
  }

  if (item.id === "synthesis-cross-source") {
    const maxSources = positiveInteger(limits.maxItems, 12);
    const maxExisting = positiveInteger(limits.maxFiles, 8);
    const sourcePaths = recentActivityRecords(fileMap).slice(0, maxSources).map((record) => record.path);
    const synthesisPaths = [...fileMap.keys()].filter((path) => path.startsWith("wiki/synthesis/") && path.endsWith(".md")).slice(0, maxExisting);
    return [
      `Processed source notes:\n${dreamFileBlocksForPaths(sourcePaths, fileMap, 1800)}`,
      `Existing synthesis pages:\n${dreamFileBlocksForPaths(synthesisPaths, fileMap, 1400)}`,
      `Existing wiki path catalog:\n${dreamWikiPathCatalog(fileMap)}`
    ].join("\n\n");
  }

  return serializeVaultContext(fileMap);
}

function dreamBrokenLinkFileSizeList(batch, fileMap) {
  const rows = batch.affectedPaths.map((path) => {
    const body = fileMap.get(path) || "";
    const linkCount = batch.links.filter((link) => link.from === path).length;
    const mode = body.length > DREAM_BROKEN_LINK_FULL_FILE_CHAR_LIMIT
      ? "snippets only"
      : "complete file included";
    return `- ${path} - ${formatByteSize(textSizeBytes(body))}; ${formatStatNumber(linkCount)} broken link${linkCount === 1 ? "" : "s"}; ${mode}`;
  });
  return rows.join("\n") || "- No affected files selected.";
}

function dreamBrokenLinkContextBlocks(batch, fileMap) {
  if (!batch.affectedPaths.length) return "_No affected files selected for this batch._";
  return batch.affectedPaths.map((path) => {
    const body = fileMap.get(path) || "";
    const links = batch.links.filter((link) => link.from === path);
    const linkLines = links.map((link) => `- [[${link.to}]]`).join("\n") || "- none";
    if (body.length <= DREAM_BROKEN_LINK_FULL_FILE_CHAR_LIMIT) {
      return [
        `Complete affected file: ${path} (${formatByteSize(textSizeBytes(body))})`,
        `Broken links in this file:\n${linkLines}`,
        `\`\`\`margins-file path="${path}"`,
        body,
        "```"
      ].join("\n");
    }
    return [
      `Large affected file: ${path} (${formatByteSize(textSizeBytes(body))})`,
      "Only snippets are included for this file. Do not return this file as a full replacement.",
      `Broken links in this file:\n${linkLines}`,
      `Snippets:\n${dreamBrokenLinkSnippetsForPath(body, links)}`
    ].join("\n");
  }).join("\n\n");
}

function dreamBrokenLinkSnippetsForPath(body, links) {
  const snippets = [];
  const ranges = [];
  for (const link of links.slice(0, DREAM_BROKEN_LINK_SNIPPETS_PER_FILE)) {
    const index = dreamBrokenLinkIndex(body, link.to);
    const range = dreamSnippetRange(body, index >= 0 ? index : 0, DREAM_BROKEN_LINK_SNIPPET_RADIUS);
    if (ranges.some((existing) => rangesOverlap(existing, range))) continue;
    ranges.push(range);
    snippets.push([
      `--- snippet around [[${link.to}]]; lines ${range.startLine}-${range.endLine} ---`,
      body.slice(range.start, range.end).trim()
    ].join("\n"));
  }
  if (!snippets.length) {
    const range = dreamSnippetRange(body, 0, DREAM_BROKEN_LINK_SNIPPET_RADIUS);
    snippets.push([
      `--- opening snippet; lines ${range.startLine}-${range.endLine} ---`,
      body.slice(range.start, range.end).trim()
    ].join("\n"));
  }
  return snippets.join("\n\n");
}

function dreamBrokenLinkIndex(body, target) {
  const pattern = new RegExp(`\\[\\[\\s*${escapeRegExp(target)}(?:#[^\\]|]+)?(?:\\|[^\\]]+)?\\s*\\]\\]`, "i");
  const match = pattern.exec(body);
  if (match) return match.index;
  return body.indexOf(`[[${target}]]`);
}

function dreamSnippetRange(body, index, radius) {
  const center = Math.max(0, Math.min(body.length, index));
  let start = Math.max(0, center - radius);
  let end = Math.min(body.length, center + radius);
  if (start > 0) start = body.lastIndexOf("\n", start) + 1 || start;
  if (end < body.length) {
    const lineEnd = body.indexOf("\n", end);
    if (lineEnd >= 0) end = lineEnd;
  }
  return {
    start,
    end,
    startLine: lineNumberAtIndex(body, start),
    endLine: lineNumberAtIndex(body, end)
  };
}

function lineNumberAtIndex(body, index) {
  return String(body || "").slice(0, Math.max(0, index)).split("\n").length;
}

function rangesOverlap(left, right) {
  return left.start <= right.end && right.start <= left.end;
}

function dreamFileBlocksForPaths(paths, fileMap, maxChars = 1800) {
  const uniquePaths = [...new Set(paths)].filter((path) => fileMap.has(path));
  if (!uniquePaths.length) return "_No matching files found in the loaded vault context._";
  return uniquePaths.map((path) => (
    `\`\`\`margins-file path="${path}"\n${truncateForPrompt(fileMap.get(path) || "", maxChars)}\n\`\`\``
  )).join("\n\n");
}

function dreamWikiPathCatalog(fileMap) {
  const entries = [...fileMap.entries()]
    .filter(([path]) => path.startsWith("wiki/") && path.endsWith(".md") && !path.startsWith("wiki/.margins/"))
    .map(([path, body]) => {
      const title = markdownTitle(body) || titleFromSlug(basename(path).replace(/\.md$/, ""));
      const type = frontmatterFields(body).type || graphTypeFromPath(path, body);
      return `- ${path} - ${title}${type ? ` (${type})` : ""}`;
    })
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 180);
  return entries.join("\n") || "- No wiki markdown files loaded.";
}

function recentActivityRecords(fileMap) {
  return [...fileMap.entries()]
    .filter(([path, body]) => isActivitySourcePagePath(path, body))
    .map(([path, body]) => activitySourceRecord(path, body, fileMap))
    .filter(Boolean)
    .sort((left, right) => (
      right.sortTimestamp - left.sortTimestamp ||
      left.title.localeCompare(right.title)
    ));
}

function activityTimelineRecords(fileMap) {
  return [
    ...recentActivityRecords(fileMap),
    ...pendingActivityRecords()
  ].sort((left, right) => (
    right.sortTimestamp - left.sortTimestamp ||
    left.title.localeCompare(right.title)
  ));
}

function isActivitySourcePagePath(path, body) {
  if (!path.startsWith("wiki/") || !path.endsWith(".md")) return false;
  if (path.startsWith("wiki/.margins/") || path.startsWith("wiki/_templates/")) return false;
  if (isBucketOverviewPath(path) || isFolderIndexPath(path)) return false;
  const type = String(frontmatterFields(body).type || "").toLowerCase();
  return type === "source" || path.startsWith("wiki/sources/") || /^wiki\/[^/]+\/source[-/]/.test(path);
}

function activitySourceRecord(path, body, fileMap) {
  const fields = frontmatterFields(body);
  const rawPath = sourceActivityRawPath(fields, body);
  const typeClass = sourceActivityTypeClass(rawPath || path);
  const dateValue = sourceActivityDateValue(fields, path);
  const title = sourceActivityTitle(path, body);
  const summary = cleanSummary(fields.summary || extractSourceSummary(body) || excerptForQuestion(bodyWithoutFrontmatter(body), 220));
  const links = sourceActivityLinks(body, fileMap).slice(0, 5);
  const tags = sourceActivityTags(fields, fileMap).slice(0, Math.max(0, 5 - links.length));
  const wordTotal = wordCount(bodyWithoutFrontmatter(body));
  const connectionCount = extractWikiLinks(sourceChecklistLinkBody(body)).length;
  return {
    kind: "processed",
    activityKey: `processed:${path}`,
    path,
    title,
    summary: clampSentence(summary || "Source note filed in the vault.", 260),
    rawPath,
    dateValue,
    sortTimestamp: sourceActivitySortTimestamp(dateValue),
    typeLabel: sourceActivityTypeLabel(rawPath || path),
    typeClass,
    links,
    tags,
    wordTotal,
    connectionCount
  };
}

function pendingActivityRecords(files = state.files) {
  return files.map((file) => {
    const dateValue = pendingSourceActivityDateValue(file);
    const typeClass = sourceBadgeClass(file);
    return {
      kind: "pending",
      activityKey: `pending:${file.name}`,
      file,
      path: rawSourceOutputPath(file.name),
      title: basename(file.name),
      summary: pendingSourceActivitySummary(file),
      dateValue,
      sortTimestamp: pendingSourceActivitySortTimestamp(file, dateValue),
      typeLabel: sourceTypeLabel(file),
      typeClass,
      links: [],
      tags: [],
      wordTotal: wordCount(file.text || ""),
      connectionCount: 0
    };
  });
}

function pendingSourceActivityDateValue(file) {
  const date = sourceTimestampDate(file);
  if (date) return date.toISOString();
  return pendingSourceDateFromName(file?.name || "");
}

function pendingSourceDateFromName(name) {
  const dateText = String(name || "").match(/(\d{4})[-_](\d{2})[-_](\d{2})/)?.slice(1, 4).join("-");
  return dateText || "";
}

function pendingSourceActivitySortTimestamp(file, dateValue = pendingSourceActivityDateValue(file)) {
  const lastModified = Number(file?.lastModified || 0);
  if (Number.isFinite(lastModified) && lastModified > 0) return lastModified;
  return sourceActivitySortTimestamp(dateValue);
}

function pendingSourceActivitySummary(file) {
  if (state.ingestErrors.has(file?.name)) {
    return "Review did not finish. This pending source is still waiting to become a filed source card.";
  }
  if (isSourceReviewReady(file)) {
    return clampSentence(sourceIngestSummary(file) || "Review complete. Approve to turn this placeholder into a filed source card.", 260);
  }
  const details = [
    formatFileSize(Number(file?.size || 0)),
    file?.text ? `${formatStatNumber(wordCount(file.text))} words` : "",
    needsTextExtraction(file) ? "needs text extraction" : ""
  ].filter(Boolean).join(" · ");
  const prefix = details ? `${details}. ` : "";
  return `Not yet processed. ${prefix}Margins will read, link, and file it as a source card.`;
}

function sourceActivityTitle(path, body) {
  const title = cleanSummary(markdownTitle(body) || titleFromSlug(basename(path).replace(/\.md$/, "")));
  return title.replace(/^Source:\s*/i, "") || "Source note";
}

function sourceActivityRawPath(fields, body) {
  const frontmatterRaw = frontmatterList(fields.raw_file)[0] || "";
  if (frontmatterRaw) return normalizeMarginsPath(frontmatterRaw);
  const match = String(body || "").match(/(?:Raw|Original) file:\s*`([^`]+)`/i);
  return match?.[1] ? normalizeMarginsPath(match[1]) : "";
}

function sourceActivityDateValue(fields, path) {
  return cleanSummary(fields.updated || fields.created || fields.event_date || sourceDateFromPath(path));
}

function sourceActivitySortTimestamp(value) {
  return activityDateValue(value)?.getTime() || 0;
}

function sourceActivityLinks(body, fileMap) {
  const seen = new Set();
  return extractWikiLinks(sourceChecklistLinkBody(body))
    .map(cleanWikiLinkLabel)
    .filter(Boolean)
    .map((label) => {
      const display = activityPillLabel(label);
      const key = display.toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        label: display,
        path: pathForWikiLinkLabel(label, fileMap)
      };
    })
    .filter(Boolean);
}

function sourceActivityTags(fields, fileMap) {
  const stop = new Set(["raw-source", "source", "transcript", "vibrance/fresh", "vibrance/peak", "vibrance/recent"]);
  return frontmatterList(fields.tags)
    .map(normalizeEntityTag)
    .filter((tag) => tag && !stop.has(tag) && !tag.startsWith("region/") && !tag.startsWith("vibrance/"))
    .map((tag) => ({
      label: activityPillLabel(tag),
      path: pathForWikiLinkLabel(tag, fileMap),
      tag
    }))
    .filter((tag) => tag.label);
}

function activityPillLabel(value) {
  const label = cleanSummary(value).replace(/^#/, "");
  if (!label) return "";
  if (/^[a-z0-9_/-]+$/.test(label)) return titleFromSlug(basename(label));
  return label;
}

function pathForWikiLinkLabel(label, fileMap) {
  const slug = slugifyLoose(cleanWikiLinkLabel(label));
  if (!slug) return "";
  const directCandidates = [
    `wiki/entities/${slug}.md`,
    `wiki/projects/${slug}.md`,
    `wiki/concepts/${slug}.md`,
    `wiki/synthesis/${slug}.md`,
    `wiki/ideas/${slug}.md`,
    `wiki/career/${slug}.md`,
    `wiki/personal/${slug}.md`,
    `wiki/school/${slug}.md`,
    `wiki/coding/${slug}.md`
  ];
  for (const candidate of directCandidates) {
    if (fileMap.has(candidate)) return candidate;
  }
  for (const [path, body] of fileMap.entries()) {
    if (!path.startsWith("wiki/") || !path.endsWith(".md")) continue;
    if (slugifyLoose(basename(path).replace(/\.md$/, "")) === slug) return path;
    if (slugifyLoose(markdownTitle(body)) === slug) return path;
  }
  return "";
}

function sourceActivityTypeLabel(path) {
  const ext = basename(path).split(".").pop()?.toUpperCase() || "SRC";
  if (ext === "MARKDOWN") return "MD";
  return ext.length <= 4 ? ext : "SRC";
}

function sourceActivityTypeClass(path) {
  const ext = basename(path).split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf") return "pdf";
  if (["eml", "msg"].includes(ext)) return "eml";
  if (["mp3", "m4a", "wav", "aac", "aiff"].includes(ext)) return "aud";
  if (["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "tif", "tiff"].includes(ext)) return "img";
  if (["doc", "docx"].includes(ext)) return "doc";
  return "txt";
}

function formatActivityDate(value) {
  const date = activityDateValue(value);
  if (!date) return "";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const age = Math.round((today - day) / (24 * 60 * 60 * 1000));
  if (age <= 0) return "today";
  if (age === 1) return "yesterday";
  if (age < 7) return `${age}d`;
  if (age < 60) return `${Math.round(age / 7)}w`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" })
  });
}

function activityDateValue(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function syncActivityRecentSource(records) {
  const sourceKey = records.map((record) => record.activityKey || record.path).join("\n");
  if (sourceKey === state.activityRecentSourceKey) return;
  state.activityRecentSourceKey = sourceKey;
  resetActivityRecentLimit();
}

function resetActivityRecentLimit() {
  state.activityRecentVisibleCount = ACTIVITY_RECENT_PAGE_SIZE;
}

function visibleActivityRecentCount(totalCount) {
  if (totalCount <= ACTIVITY_RECENT_PAGE_SIZE) return totalCount;
  const requested = Math.max(
    ACTIVITY_RECENT_PAGE_SIZE,
    Number(state.activityRecentVisibleCount) || ACTIVITY_RECENT_PAGE_SIZE
  );
  state.activityRecentVisibleCount = Math.min(requested, totalCount);
  return state.activityRecentVisibleCount;
}

function renderActivityRecentActions(visibleCount, totalCount) {
  if (visibleCount >= totalCount) return "";
  const remaining = totalCount - visibleCount;
  const nextCount = Math.min(ACTIVITY_RECENT_PAGE_SIZE, remaining);
  const showMoreLabel = remaining > ACTIVITY_RECENT_PAGE_SIZE ? `Show ${nextCount} more` : `Show remaining ${remaining}`;
  return `
    <div class="entity-section-actions activity-section-actions">
      <button class="entity-list-button primary" type="button" data-activity-list-action="show-more-recent" data-activity-recent-total="${escapeHtml(String(totalCount))}">
        ${escapeHtml(showMoreLabel)}
      </button>
      <button class="entity-list-button" type="button" data-activity-list-action="show-all-recent" data-activity-recent-total="${escapeHtml(String(totalCount))}">
        Show all ${escapeHtml(String(totalCount))}
      </button>
    </div>
  `;
}

function renderRecentActivityCard(record) {
  if (record.kind === "pending") return renderPendingActivityCard(record);
  const dateLabel = formatActivityDate(record.dateValue);
  return `
    <article class="activity-card type-${escapeHtml(record.typeClass)}" role="button" tabindex="0" data-activity-path="${escapeHtml(record.path)}">
      <div class="activity-card-top">
        <span class="source-icon ${escapeHtml(record.typeClass)}">${escapeHtml(record.typeLabel)}</span>
        <div class="activity-card-title">${escapeHtml(record.title)}</div>
        ${dateLabel ? `<time class="activity-card-date" datetime="${escapeHtml(record.dateValue)}">${escapeHtml(dateLabel)}</time>` : ""}
      </div>
      <p class="activity-card-summary">${escapeHtml(record.summary)}</p>
      ${renderActivityPills(record)}
      <div class="activity-card-foot">
        <span class="stat"><strong>${escapeHtml(formatStatNumber(record.wordTotal))}</strong> words</span>
        <span class="stat">Connected to <strong>${escapeHtml(String(record.connectionCount))}</strong> page${record.connectionCount === 1 ? "" : "s"}</span>
      </div>
    </article>
  `;
}

function renderPendingActivityCard(record) {
  const file = record.file;
  const dateLabel = formatActivityDate(record.dateValue);
  return `
    <article class="activity-card ghost type-${escapeHtml(record.typeClass)}" data-pending-source="${escapeHtml(file.name)}">
      <div class="activity-card-top">
        <span class="source-icon ${escapeHtml(record.typeClass)}">${escapeHtml(record.typeLabel)}</span>
        <div class="activity-card-title">${escapeHtml(record.title)}</div>
        ${dateLabel ? `<time class="activity-card-date" datetime="${escapeHtml(record.dateValue)}">${escapeHtml(dateLabel)}</time>` : ""}
      </div>
      <p class="activity-card-summary">${escapeHtml(record.summary)}</p>
      <div class="ghost-actions" aria-label="Pending source actions">
        ${renderSourceActionButton(file, "primary ghost-action-primary")}
        <button type="button" data-source-open-path="${escapeHtml(rawSourceOutputPath(file.name))}">Preview source</button>
        <button type="button" data-source-delete="${escapeHtml(file.name)}">Skip</button>
      </div>
    </article>
  `;
}

function renderActivityPills(record) {
  const candidates = [
    ...record.links.map((link) => ({
      key: normalizeEntityTag(link.label),
      html: link.path
        ? `<button class="activity-pill" type="button" data-activity-target-path="${escapeHtml(link.path)}">${escapeHtml(link.label)}</button>`
        : `<button class="activity-pill" type="button" data-activity-tag="${escapeHtml(normalizeEntityTag(link.label))}">${escapeHtml(link.label)}</button>`
    })),
    ...record.tags.map((tag) => ({
      key: normalizeEntityTag(tag.label),
      html: tag.path
        ? `<button class="activity-pill" type="button" data-activity-target-path="${escapeHtml(tag.path)}">${escapeHtml(tag.label)}</button>`
        : `<button class="activity-pill" type="button" data-activity-tag="${escapeHtml(tag.tag)}">${escapeHtml(tag.label)}</button>`
    }))
  ];
  const seen = new Set();
  const pills = [];
  for (const candidate of candidates) {
    if (!candidate.key || seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    pills.push(candidate.html);
    if (pills.length >= 5) break;
  }
  return pills.length ? `<div class="activity-card-pills">${pills.join("")}</div>` : "";
}

async function handleRecentActivityClick(event) {
  const actionButton = event.target.closest("[data-activity-list-action]");
  if (actionButton && els.recentActivityList?.contains(actionButton)) {
    event.preventDefault();
    event.stopPropagation();
    const totalCount = Math.max(0, Number(actionButton.dataset.activityRecentTotal) || 0);
    if (actionButton.dataset.activityListAction === "show-more-recent") {
      state.activityRecentVisibleCount = Math.min(
        totalCount,
        Math.max(ACTIVITY_RECENT_PAGE_SIZE, state.activityRecentVisibleCount) + ACTIVITY_RECENT_PAGE_SIZE
      );
    } else if (actionButton.dataset.activityListAction === "show-all-recent") {
      state.activityRecentVisibleCount = totalCount;
    }
    renderRecentActivity(activeActivityFileMap());
    return;
  }

  const sourceAction = event.target.closest("[data-source-action]");
  if (sourceAction && els.recentActivityList?.contains(sourceAction)) {
    event.preventDefault();
    event.stopPropagation();
    if (!state.processingInbox) {
      await withBusyOperation("source processing", () => processPendingSource(sourceAction.dataset.sourceFile));
    }
    return;
  }

  const rawPreview = event.target.closest("[data-source-open-path]");
  if (rawPreview && els.recentActivityList?.contains(rawPreview)) {
    event.preventDefault();
    event.stopPropagation();
    openActivityPath(rawPreview.dataset.sourceOpenPath);
    return;
  }

  const deleteButton = event.target.closest("[data-source-delete]");
  if (deleteButton && els.recentActivityList?.contains(deleteButton)) {
    event.preventDefault();
    event.stopPropagation();
    await withBusyOperation("source removal", () => removePendingSource(deleteButton.dataset.sourceDelete));
    return;
  }

  const pill = event.target.closest("[data-activity-target-path]");
  if (pill && els.recentActivityList?.contains(pill)) {
    event.preventDefault();
    event.stopPropagation();
    openActivityPath(pill.dataset.activityTargetPath);
    return;
  }

  const tagPill = event.target.closest("[data-activity-tag]");
  if (tagPill && els.recentActivityList?.contains(tagPill)) {
    event.preventDefault();
    event.stopPropagation();
    openActivityTag(tagPill.dataset.activityTag);
    return;
  }

  const card = event.target.closest("[data-activity-path]");
  if (!card || !els.recentActivityList?.contains(card)) return;
  openActivityPath(card.dataset.activityPath);
}

function handleRecentActivityKeydown(event) {
  if (!["Enter", " "].includes(event.key)) return;
  if (event.target.closest("button, input, textarea, select, a")) return;
  const card = event.target.closest("[data-activity-path]");
  if (!card || !els.recentActivityList?.contains(card)) return;
  event.preventDefault();
  openActivityPath(card.dataset.activityPath);
}

function openActivityPath(path) {
  if (!path) return;
  activateTab("wiki");
  selectVaultPath(path);
}

function openActivityTag(tag) {
  const normalized = normalizeEntityTag(tag);
  if (!normalized) return;
  state.entityFilterKind = "tag";
  state.entityFilterValue = normalized;
  resetEntityRecentLimit();
  activateTab("entities");
  renderEntities(activeEntityFileMap());
}

function renderSourceIngestRun(file) {
  const processingThis = state.processingInbox && (!state.processingFileName || state.processingFileName === file.name);
  const reviewReady = isSourceReviewReady(file);
  const error = state.ingestErrors.get(file.name);
  if (!processingThis && !reviewReady && !error) return "";
  if (error && !processingThis) return renderSourceIngestError(file, error);
  const review = state.ingestReviews.get(file.name);
  // If a review already exists, keep showing the receipt — don't fall back
  // to the processing checklist when the user clicks Approve (which sets
  // processingInbox=true during the save). That would look like reprocessing.
  const showReceipt = reviewReady;
  return `
    <div class="source-ingest-run">
      ${showReceipt ? renderSourceReceipt(file, review) : renderSourceProcessingChecklist(file)}
    </div>
  `;
}

function renderSourceProcessingChecklist(file) {
  const lines = processingFilingLines(file)
    .filter((line) => !line.pending)
    .map((line) => ({
      ...line,
      settled: Boolean(line.done && !line.active)
    }));
  return renderReceiptLog(lines, { processing: true });
}

function renderSourceGeneratedChecklist(file, review) {
  return renderFilingStream(file, {
    status: modelReviewStepLabel(review),
    processing: false,
    lines: sourceFilingChecklist(file, review)
  });
}

function renderSourceReceipt(file, review) {
  const entry = sourceNoteEntryForFile(file);
  const path = entry?.path || sourceTargetPathFromReview(rawSourceOutputPath(file.name), review);
  const essence = sourceReceiptEssence(file, review);
  const questions = state.reviewMode === "auto" ? [] : reviewQuestionsForCard(file, review);
  // Stage the staged-reveal class on the FIRST render of this file's receipt
  // so the receipt sections fade in one-by-one. Subsequent re-renders (Approve,
  // decision-button click, etc.) do NOT get the class — the receipt stays static.
  const firstReveal = !state.revealedReceipts.has(file.name);
  if (firstReveal) state.revealedReceipts.add(file.name);
  const cls = `source-receipt${firstReveal ? " is-revealing" : ""}`;
  return `
    <div class="${cls}">
      ${essence ? `<p class="receipt-essence">${escapeHtml(essence)}</p>` : ""}
      ${renderSourceReceiptChecklist(file, review, path)}
      ${renderSourceReceiptDecision(file, questions)}
      <div class="receipt-footer">
        ${renderSourceActionButton(file, "source-process-btn run-action-btn")}
        ${renderSourceReceiptDetails(file, review)}
      </div>
    </div>
  `;
}

function renderSourceTopStatus(file) {
  if (!file?.name) return "";
  const processingThis = state.processingInbox && (!state.processingFileName || state.processingFileName === file.name);
  const review = state.ingestReviews.get(file.name);
  const questions = reviewQuestionsForCard(file, review);
  let label = "";
  let tone = "";
  if (processingThis) {
    label = "Working";
    tone = "working";
  } else if (state.ingestErrors.has(file.name)) {
    label = "Review needed";
    tone = "warn";
  } else if (isSourceReviewReady(file)) {
    label = questions.length ? `${questions.length} decision${questions.length === 1 ? "" : "s"}` : "Done";
    tone = questions.length ? "warn" : "done";
  }
  return label ? `<span class="source-status-pill ${tone}">${escapeHtml(label)}</span>` : "";
}

function renderSourceReceiptChecklist(file, review, path = "") {
  const lines = sourceReceiptChecklistLines(file, review, path);
  if (!lines.length) return "";
  return renderReceiptLog(lines);
}

function renderReceiptLog(lines = [], { processing = false } = {}) {
  return `
    <div class="receipt-log ${processing ? "processing" : "complete"}">
      ${lines.map((line, index) => renderReceiptLogLine(line, index, { processing })).join("")}
    </div>
  `;
}

function sourceReceiptChecklistLines(file, review, path = "") {
  const processLines = completedProcessingFilingLines(file);
  const generatedLines = sourceFilingChecklist(file, review)
    .filter((line) => !isGeneratedProcessDuplicate(file, line))
    .map((line) => ({
      ...line,
      append: true
    }));
  const lines = [...processLines, ...generatedLines];
  let filedLine = null;
  if (path) {
    filedLine = {
      html: `Filed to <button type="button" class="receipt-inline-path" data-source-open-path="${escapeHtml(path)}">${escapeHtml(path.replace(/^wiki\//, ""))}</button>`,
      append: true,
      final: true
    };
    lines.push(filedLine);
  }
  const deduped = dedupeFilingLines(lines);
  const maxLines = 10;
  if (!path || deduped.length <= maxLines) return deduped.slice(0, maxLines);
  const finalLine = deduped.includes(filedLine) ? filedLine : deduped[deduped.length - 1];
  return deduped.filter((line) => line !== finalLine).slice(0, maxLines - 1).concat(finalLine);
}

function completedProcessingFilingLines(file) {
  return processingFilingLines(file).map((line) => ({
    ...line,
    done: true,
    active: false,
    pending: false,
    settled: true,
    process: true
  }));
}

function isGeneratedProcessDuplicate(file, line) {
  const text = cleanSummary(String(line?.html || line?.text || "").replace(/<[^>]*>/g, ""));
  if (!text) return true;
  if (/^(read|reading)\b/i.test(text)) return true;
  if (/^saving\b/i.test(text)) return true;
  if (/comparing it against your brain/i.test(text)) return true;
  if (/converting to markdown/i.test(text)) return true;
  if (text.includes(basename(file.name)) && /source|pdf|docx|text/i.test(text) && /read|reading/i.test(text)) return true;
  return false;
}

function renderReceiptLogLine(line, index) {
  const classes = [
    "receipt-log-line",
    line.settled ? "settled" : "",
    line.active ? "active" : "",
    line.pending ? "pending" : "",
    line.append ? "append" : "",
    line.process ? "process" : "",
    line.insight ? "insight" : "",
    line.final ? "final" : ""
  ].filter(Boolean).join(" ");
  const marker = line.active
    ? '<span class="filing-spinner" aria-hidden="true"></span>'
    : '<span aria-hidden="true">✓</span>';
  return `
    <div class="${classes}" style="--line-index:${index}">
      <div class="receipt-log-line-inner">
        <span class="receipt-log-check" aria-hidden="true">${marker}</span>
        <div class="receipt-log-content">${line.html || escapeHtml(line.text || "")}</div>
      </div>
    </div>
  `;
}

function renderSourceReceiptDecision(file, questions = []) {
  if (!questions.length) return "";
  const question = questions[0];
  const answered = ingestAnswerFor(file.name, question.question);
  const displayQuestion = displayQuestionText(question);
  const displayAnswer = displayQuestionAnswerLabel(question, answered);
  return `
    <div class="receipt-decision ${answered ? "answered" : ""}">
      <span class="run-kicker">Needs your call</span>
      <p>${escapeHtml(displayQuestion)}</p>
      <div class="quick-actions">
        ${compactQuestionOptions(question).map((option, index) => {
          const selected = answered === option.value;
          return `
            <button class="quick-answer ${index === 0 ? "primary" : ""} ${selected ? "selected" : ""}" type="button" data-run-answer="${escapeHtml(option.value)}" data-question="${escapeHtml(question.question)}" data-file="${escapeHtml(file.name)}" aria-pressed="${selected ? "true" : "false"}" onclick="event.stopImmediatePropagation(); window.__marginsRunAnswer?.(this.dataset.file, this.dataset.question, this.dataset.runAnswer)">${escapeHtml(option.label)}</button>
          `;
        }).join("")}
      </div>
      ${answered ? `<div class="answered-note">Answered: ${escapeHtml(displayAnswer)}</div>` : ""}
      ${questions.length > 1 ? `<div class="run-note">${escapeHtml(String(questions.length - 1))} more decision${questions.length - 1 === 1 ? "" : "s"} in Details.</div>` : ""}
    </div>
  `;
}

function compactQuestionOptions(question) {
  const options = question.options?.length ? question.options : ["Yes", "No", "Use default"];
  const cleanOptions = uniqueBy(options.map((option) => displayQuestionOption(question, option)).filter((option) => option.value), (option) => option.value.toLowerCase());
  return (cleanOptions.length ? cleanOptions : ["Yes", "No"].map((option) => ({ value: option, label: option }))).slice(0, 3);
}

function displayQuestionText(question) {
  const bucketOptions = filingBucketOptions(question);
  if (bucketOptions.length >= 2) {
    return `Does this belong in ${formatBucketChoiceList(bucketOptions.map((option) => option.bucket))}?`;
  }
  return question.question || "What should Margins do?";
}

function displayQuestionOption(question, option) {
  const value = cleanSummary(option);
  if (!value) return { value: "", label: "" };
  const bucketOption = filingBucketOption(value);
  return bucketOption ? { value, label: titleFromSlug(bucketOption.bucket) } : { value, label: value };
}

function displayQuestionAnswerLabel(question, answer) {
  if (!answer) return "";
  return displayQuestionOption(question, answer).label || answer;
}

function filingBucketOptions(question) {
  const options = question?.options?.length ? question.options : [];
  return uniqueBy(options.map(filingBucketOption).filter(Boolean), (option) => option.bucket);
}

function filingBucketOption(option) {
  const value = cleanSummary(option);
  if (!value || /^skip$/i.test(value)) return null;
  const match = value.match(/^(?:wiki\/)?([^/\s]+)\/.+\.md$/i);
  if (!match) return null;
  return { value, bucket: match[1].toLowerCase() };
}

function formatBucketChoiceList(buckets) {
  const labels = uniqueBy(buckets.filter(Boolean), (bucket) => bucket)
    .map((bucket) => bucket.replace(/-/g, " "));
  if (labels.length <= 1) return labels[0] || "this bucket";
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, or ${labels[labels.length - 1]}`;
}

function renderSourceReceiptDetails(file, review) {
  const details = [
    renderSourceProcessedLine(file, review),
    renderSourceRunNotice(review),
    renderSourceGeneratedChecklist(file, review),
    state.reviewMode !== "auto" ? renderSourceFilingPlan(file) : "",
    state.reviewMode !== "auto" ? renderSourceSummary(file) : "",
    state.reviewMode !== "auto" ? renderSourceFinancialDetails(file) : "",
    state.reviewMode !== "auto" ? renderSourceConnections(file) : "",
    state.reviewMode !== "auto" ? renderSourceLightTouch(file) : "",
    state.reviewMode !== "auto" ? renderSourcePropagation(file) : "",
    state.reviewMode !== "auto" ? renderSourceRunQuestions(file, { detailsOnly: true }) : ""
  ].filter(Boolean).join("");
  return `
    <details class="receipt-details" ${state.expandedSummaries.has(file.name) ? "open" : ""}>
      <summary>Details</summary>
      <div class="receipt-details-body">
        ${details}
      </div>
    </details>
  `;
}

function renderSourceProcessedLine(file, review) {
  return `<div class="receipt-processed">${escapeHtml(sourceProcessedLine(file, review))}</div>`;
}

function sourceProcessedLine(file, review) {
  const processTiming = latestProcessTimingForFile(file.name);
  const parts = [processTiming?.totalMs ? `Processed in ${formatProcessDuration(processTiming.totalMs)}` : "Processed"];
  const pages = sourcePageCount(file);
  const words = wordCount(file.text || "");
  const considered = review?.filingPlan?.candidateFiles?.length || 0;
  if (pages > 0) parts.push(`${pages} ${pluralize("page", pages)}`);
  if (words > 0) parts.push(`~${formatStatNumber(words)} ${pluralize("word", words)}`);
  if (considered > 0) parts.push(`${considered} ${pluralize("file", considered)} considered`);
  return parts.join(" · ");
}

function sourceReceiptEssence(file, review) {
  const summary = sourceIngestFullSummary(file);
  if (summary) return clampSentence(summary, 190);
  const takeaway = review?.takeaways?.find((item) => item?.point)?.point || "";
  return clampSentence(takeaway || "Source page drafted and ready for review.", 190);
}

function renderFilingStream(file, { status, lines = [], processing = false, showHeader = true } = {}) {
  const cleanLines = lines.length ? lines : [{ html: escapeHtml(sourceReadLine(file)), active: processing }];
  return `
    <div class="filing-stream ${processing ? "processing" : "complete"}">
      ${showHeader ? `
        <div class="filing-stream-head">
          <div class="filing-stream-thumb ${escapeHtml(sourceBadgeClass(file))}">${escapeHtml(sourceTypeLabel(file))}</div>
          <div class="filing-stream-meta">
            <div class="filing-stream-title">${escapeHtml(basename(file.name))}</div>
            <div class="filing-stream-sub">${escapeHtml(sourceStreamSubline(file, processing))}</div>
          </div>
          <div class="filing-stream-status">${processing ? '<span class="dot"></span>' : ""}${escapeHtml(status || "Ready")}</div>
        </div>
      ` : ""}
      <div class="filing-stream-lines">
        ${cleanLines.map((line, index) => renderFilingStreamLine(line, index, processing)).join("")}
      </div>
    </div>
  `;
}

function renderFilingStreamLine(line, index, processing = false) {
  const active = Boolean(line.active);
  const done = line.done !== undefined ? Boolean(line.done) : !active;
  const classes = [
    "filing-stream-line",
    done ? "done" : "",
    active ? "active" : "",
    line.pending ? "pending" : "",
    line.insight ? "insight" : "",
    line.final ? "final" : ""
  ].filter(Boolean).join(" ");
  const marker = active && processing
    ? '<span class="filing-spinner" aria-hidden="true"></span>'
    : '<span aria-hidden="true">✓</span>';
  return `
    <div class="${classes}" style="--line-index:${index}">
      <span class="filing-check">${marker}</span>
      <span>${line.html || escapeHtml(line.text || "")}</span>
    </div>
  `;
}

function sourceStreamSubline(file, processing = false) {
  return [
    formatFileSize(file.size),
    sourceTimestampDate(file) ? formatSourceTimestamp(sourceTimestampDate(file)) : processing ? "uploaded just now" : "ready for approval"
  ].filter(Boolean).join(" · ");
}

function processingFilingLines(file) {
  const rawSaved = rawSourceAlreadySaved(file);
  const readable = Boolean(file.text);
  const stage = ingestProgressStage(file);
  const lines = [
    {
      html: escapeHtml(`Saving ${sourceTypeLabel(file)} source file`),
      done: rawSaved || stage > 0,
      active: stage === 0,
      pending: stage < 0
    },
    {
      html: escapeHtml(sourceReadLine(file)),
      done: readable && stage > 1,
      active: stage === 1 || stage > 1 && !readable,
      pending: stage < 1
    },
    {
      html: escapeHtml(state.apiSecret && canSendSourceToModel(file)
        ? "Margins is comparing it against your brain"
        : "Generating a local filing review"),
      done: stage > 2,
      active: stage === 2,
      pending: stage < 2
    },
    {
      html: escapeHtml(sourceFormatStepLine(file)),
      done: false,
      active: stage >= 3,
      pending: stage < 3
    }
  ];
  return lines;
}

function sourceFormatStepLine(file) {
  const ext = basename(file?.name || "").split(".").pop()?.toLowerCase() || "";
  if (["md", "markdown"].includes(ext)) return "Preparing Markdown file for filing";
  return "Converting to Markdown file structure";
}

function ingestProgressStage(file) {
  const progress = state.ingestProgress.get(file?.name || "");
  if (!progress) {
    const rawSaved = rawSourceAlreadySaved(file);
    const readable = Boolean(file?.text);
    if (rawSaved && readable) return 2;
    if (rawSaved) return 1;
    return 0;
  }
  const elapsed = performance.now() - progress.startedAt;
  let stage = 0;
  for (let index = 0; index < ingestProgressStepDelaysMs.length; index += 1) {
    if (elapsed >= ingestProgressStepDelaysMs[index]) stage = index;
  }
  return Math.min(stage, 3);
}

function sourceFilingChecklist(file, review) {
  const stats = sourceChecklistStats(file, review);
  const modelLines = parseFilingSteps(review?.filingSteps);
  if (modelLines.length >= 4) {
    return modelLines.map((text, index) => ({
      html: /^linked to\b/i.test(cleanFilingStep(text)) && stats.linkedEntities.length > 0
        ? linkedEntitiesLineHtml(file, stats.linkedEntities)
        : filingStepHtml(text),
      insight: /contradict|conflict|discover|flag|review/i.test(text),
      final: index === modelLines.length - 1 || /filed|prepared|ready/i.test(text)
    }));
  }

  const lines = [
    { html: escapeHtml(sourceReadLine(file)) }
  ];

  if (stats.entityTotal > 0) {
    lines.push({
      html: escapeHtml(`Detected ${stats.entityTotal} ${pluralize("entity", stats.entityTotal)} · ${stats.existingEntityTotal} already in your brain`)
    });
  }

  lines.push({
    html: `${escapeHtml(stats.sourceVerb)} ${filingPill(stats.sourceTitle, stats.sourcePath)} as a ${stats.sourceVerb === "Updated" ? "source" : "new source"}`
  });

  for (const entity of stats.updatedEntities.slice(0, 3)) {
    lines.push({
      html: `Updated ${filingPill(entity.title, entity.path)}${entity.reason ? ` · ${escapeHtml(entity.reason)}` : ""}`
    });
  }

  if (stats.linkedEntities.length > 0) {
    lines.push({
      html: linkedEntitiesLineHtml(file, stats.linkedEntities)
    });
  }

  for (const discovery of stats.discoveries.slice(0, 2)) {
    lines.push({
      html: filingStepHtml(`Discovered: ${discovery}`),
      insight: true
    });
  }

  lines.push({
    html: escapeHtml(sourceFinalFilingLine(stats)),
    final: true
  });

  return dedupeFilingLines(lines).slice(0, 8);
}

function sourceChecklistStats(file, review) {
  const sourceEntry = sourceNoteEntryForFile(file);
  const sourceTitle = sourceEntry ? sourceActivityTitle(sourceEntry.path, sourceEntry.body) : titleFromSlug(basename(file.name).replace(/\.[^.]+$/, ""));
  const sourcePath = sourceEntry?.path || "";
  const sourceVerb = sourceEntry && state.loadedFileMap?.has(sourceEntry.path) ? "Updated" : "Created";
  const links = sourceEntry ? sourceChecklistSourceLinks(sourceEntry.body) : [];
  const connectionRecords = sourceChecklistConnections(review, links);
  const updatedEntities = changedEntityRecords(connectionRecords);
  const linkedEntities = connectionRecords
    .filter((record) => !updatedEntities.some((updated) => updated.key === record.key))
    .slice(0, 5);
  const discoveries = sourceChecklistDiscoveries(review);
  const entityTotal = connectionRecords.length;
  const existingEntityTotal = connectionRecords.filter((record) => record.exists).length;
  return {
    sourceTitle,
    sourcePath,
    sourceVerb,
    entityTotal,
    existingEntityTotal,
    updatedEntities,
    linkedEntities,
    discoveries,
    flaggedCount: Math.max(discoveries.length, review?.questions?.length || 0),
    updateCount: Math.max(updatedEntities.length, review?.propagation?.length || 0),
    linkCount: linkedEntities.length
  };
}

function sourceChecklistSourceLinks(body) {
  return extractWikiLinks(sourceChecklistLinkBody(body))
    .map(cleanWikiLinkLabel)
    .filter(Boolean);
}

function sourceChecklistLinkBody(body) {
  const ignoredSections = new Set([
    "candidate concepts",
    "candidate entities",
    "entity candidates",
    "inferences refused",
    "key terms",
    "mentioned but missing"
  ]);
  const kept = [];
  let ignoredLevel = 0;
  for (const line of String(body || "").split("\n")) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const title = cleanSummary(heading[2]).toLowerCase();
      if (ignoredLevel && level <= ignoredLevel) ignoredLevel = 0;
      if (ignoredSections.has(title)) {
        ignoredLevel = level;
        continue;
      }
    }
    if (!ignoredLevel) kept.push(line);
  }
  return kept.join("\n");
}

function sourceChecklistConnections(review, sourceLinks = []) {
  const records = [];
  for (const connection of review?.connections || []) {
    const title = connection.title || titleFromConnectionPath(connection.path);
    if (!title && !connection.path) continue;
    if (isGenericChecklistLink(title || connection.path)) continue;
    records.push({
      key: connection.path || slugifyLoose(title),
      path: normalizeMarginsPath(connection.path || ""),
      title: title || connection.path,
      reason: clampSentence(connection.reason || "", 120),
      exists: connection.type === "existing" || Boolean(connection.path && state.loadedFileMap?.has(normalizeMarginsPath(connection.path)))
    });
  }
  for (const link of sourceLinks) {
    if (isGenericChecklistLink(link)) continue;
    const existing = sourceConnectionForLink(link);
    records.push({
      key: existing.path || slugifyLoose(link),
      path: existing.path,
      title: existing.title || link,
      reason: "",
      exists: Boolean(existing.path)
    });
  }
  return uniqueBy(records.filter((record) => record.title), (record) => record.key || slugifyLoose(record.title)).slice(0, 8);
}


function changedEntityRecords(records) {
  const changed = [];
  for (const record of records) {
    const path = record.path;
    if (!path || !state.currentFileMap?.has(path)) continue;
    if (isActivitySourcePagePath(path, state.currentFileMap.get(path))) continue;
    const previous = state.loadedFileMap?.get(path) || "";
    const current = state.currentFileMap.get(path) || "";
    if (current && current !== previous) changed.push(record);
  }
  return changed;
}

function sourceChecklistDiscoveries(review) {
  const discoveries = (review?.discoveries || [])
    .map((item) => cleanSummary([item.title, item.detail].filter(Boolean).join(" · ")))
    .filter(Boolean);
  const flaggedQuestions = (review?.questions || [])
    .filter((question) => /contradict|conflict|sensitive|risk|warn|review/i.test(`${question.kind} ${question.question} ${question.recommendation}`))
    .map((question) => cleanSummary(question.recommendation || question.question))
    .filter(Boolean);
  return [...discoveries, ...flaggedQuestions].map((item) => clampSentence(item, 180)).slice(0, 3);
}

function sourceFinalFilingLine(stats) {
  const parts = ["Prepared source page"];
  if (stats.updateCount > 0) parts.push(`${stats.updateCount} ${pluralize("entity update", stats.updateCount)}`);
  else if (stats.linkCount > 0) parts.push(`${stats.linkCount} ${pluralize("entity link", stats.linkCount)}`);
  if (stats.flaggedCount > 0) parts.push(`${stats.flaggedCount} flagged for review`);
  return parts.join(" · ");
}

function sourceReadLine(file) {
  const details = [];
  const pages = sourcePageCount(file);
  const words = wordCount(file.text || "");
  if (pages > 0) details.push(`${pages} ${pluralize("page", pages)}`);
  if (words > 0) details.push(`~${formatStatNumber(words)} ${pluralize("word", words)}`);
  if (details.length === 0 && file.size) details.push(formatFileSize(file.size));
  return `Reading ${sourceTypeLabel(file)}${details.length ? ` — ${details.join(", ")}` : ""}`;
}

function sourcePageCount(file) {
  const explicit = Number(file?.pageCount || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const matches = String(file?.text || "").match(/^Page\s+\d+/gm);
  return matches?.length || 0;
}

function filingStepHtml(text) {
  const clean = cleanFilingStep(text);
  const prefixMatch = clean.match(/^(Discovered|Flagged|Contradiction|Conflict):\s*(.+)$/i);
  if (prefixMatch) {
    return `<strong>${escapeHtml(prefixMatch[1])}:</strong> ${escapeHtml(prefixMatch[2])}`;
  }
  return escapeHtml(clean);
}

function filingPill(value, path = "") {
  const label = escapeHtml(value || "Source");
  const cleanPath = normalizeMarginsPath(path || "");
  if (cleanPath) {
    return `<button class="filing-pill" type="button" data-source-open-path="${escapeHtml(cleanPath)}">${label}</button>`;
  }
  return `<span class="filing-pill">${label}</span>`;
}

function joinFilingPills(records) {
  const pills = records.map((record) => {
    const priorMentions = record.exists ? sourcePriorMentionCount(record) : 0;
    return `${filingPill(record.title, record.path)}${priorMentions > 1 ? escapeHtml(` (${priorMentions} prior mentions)`) : ""}`;
  });
  if (pills.length <= 1) return pills.join("");
  return `${pills.slice(0, -1).join(", ")} and ${pills[pills.length - 1]}`;
}

function linkedEntitiesLineHtml(file, records = []) {
  const linked = records.filter((record) => record?.title);
  const expanded = state.expandedReceiptLinks.has(file?.name || "");
  const visible = expanded ? linked : linked.slice(0, 3);
  const remaining = Math.max(0, linked.length - visible.length);
  const toggle = remaining > 0
    ? receiptLinksToggleButton(file.name, `and ${remaining} more`, false)
    : expanded && linked.length > 3
      ? receiptLinksToggleButton(file.name, "show fewer", true)
      : "";
  const pieces = remaining > 0
    ? visible.map(linkedEntityItemHtml).join(", ")
    : inlineListHtml(visible.map(linkedEntityItemHtml));
  return `
    <span class="receipt-linked">Linked to ${pieces}${toggle ? ` ${toggle}` : ""}</span>
  `;
}

function receiptLinksToggleButton(fileName, label, expanded = false) {
  return `<button class="receipt-linked-more" type="button" data-receipt-links-toggle="${escapeHtml(fileName || "")}" aria-expanded="${expanded ? "true" : "false"}">${escapeHtml(label)}</button>`;
}

function linkedEntityItemHtml(record) {
  const priorMentions = record.exists ? sourcePriorMentionCount(record) : 0;
  return `${filingPill(record.title, record.path)}${priorMentions > 1 ? ` <span class="receipt-linked-meta">${escapeHtml(`(${priorMentions} prior mentions)`)}</span>` : ""}`;
}

function inlineListHtml(items = []) {
  const cleanItems = items.filter(Boolean);
  if (cleanItems.length <= 1) return cleanItems.join("");
  if (cleanItems.length === 2) return `${cleanItems[0]} and ${cleanItems[1]}`;
  return `${cleanItems.slice(0, -1).join(", ")} and ${cleanItems[cleanItems.length - 1]}`;
}

function sourcePriorMentionCount(record) {
  const needles = [
    record.path,
    record.title,
    record.path ? basename(record.path).replace(/\.md$/, "") : ""
  ].filter(Boolean).map((item) => String(item).toLowerCase());
  if (!needles.length || !state.loadedFileMap?.size) return 0;
  let count = 0;
  for (const body of state.loadedFileMap.values()) {
    const text = String(body || "").toLowerCase();
    if (needles.some((needle) => needle && text.includes(needle))) count += 1;
  }
  return count;
}

function sourceConnectionForLink(link) {
  const label = cleanWikiLinkLabel(link);
  const slug = slugifyLoose(label);
  for (const [path, body] of state.currentFileMap || []) {
    if (!path.startsWith("wiki/") || !path.endsWith(".md")) continue;
    const title = markdownTitle(body) || titleFromSlug(basename(path).replace(/\.md$/, ""));
    if (slugifyLoose(title) === slug || basename(path).replace(/\.md$/, "") === label || path.endsWith(`/${slug}.md`)) {
      return { path, title };
    }
  }
  return { path: "", title: label };
}

function titleFromConnectionPath(path) {
  return path ? titleFromSlug(basename(path).replace(/\.md$/, "")) : "";
}

function dedupeFilingLines(lines) {
  const seen = new Set();
  return lines.filter((line) => {
    const key = cleanSummary(String(line.html || line.text || "").replace(/<[^>]*>/g, "")).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
    return `<div class="run-warning">Margins review is rate-limited right now, so Margins is showing the local review. Retry later for model-generated questions.</div>`;
  }
  if (review.source === "local") {
    return `<div class="run-warning">${escapeHtml(review.status)}</div>`;
  }
  if (review.modelSummaryFallback) {
    return `<div class="run-note">${escapeHtml(review.status)}</div>`;
  }
  if (review.modelReturnedNoQuestions) {
    return `<div class="run-note">${escapeHtml(review.status)}</div>`;
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
  if (review?.source === "api") return "Margins reviewed";
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

function renderSourceRunQuestions(file, { detailsOnly = false } = {}) {
  const review = state.ingestReviews.get(file.name);
  const questions = reviewQuestionsForCard(file, review);
  if (questions.length === 0) {
    if (detailsOnly) return "";
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
          <p class="run-prompt-question">${escapeHtml(displayQuestionText(question))}</p>
          ${question.recommendation ? `<div class="recommendation run-prompt-take">${escapeHtml(question.recommendation)}</div>` : ""}
          <div class="quick-actions">
            ${questionOptionsWithSkip(question).map((option, index) => {
              const selected = ingestAnswerFor(file.name, question.question) === option.value;
              return `
                <button class="quick-answer ${index === 0 ? "primary" : ""} ${selected ? "selected" : ""}" type="button" data-run-answer="${escapeHtml(option.value)}" data-question="${escapeHtml(question.question)}" data-file="${escapeHtml(file.name)}" aria-pressed="${selected ? "true" : "false"}" onclick="event.stopImmediatePropagation(); window.__marginsRunAnswer?.(this.dataset.file, this.dataset.question, this.dataset.runAnswer)">${escapeHtml(option.label)}</button>
              `;
            }).join("")}
          </div>
      ${ingestAnswerFor(file.name, question.question) ? `<div class="answered-note">Answered: ${escapeHtml(displayQuestionAnswerLabel(question, ingestAnswerFor(file.name, question.question)))}</div>` : ""}
        </div>
      `).join("")}
    </div>
    ${detailsOnly ? "" : renderSourceActionRow(file, {
      note: answeredCount === questions.length
        ? "Ready to file."
        : `${answeredCount}/${questions.length} answered. Skip anything that does not need your call.`
    })}
  `;
}

function reviewQuestionsForCard(file, review) {
  if (review?.questions?.length) return review.questions;
  if (review?.fallbackQuestions?.length) return review.fallbackQuestions;
  return currentIngestQuestionsForFile(file, state.currentFileMap, state.reviewMode);
}

function renderSourceFilingPlan(file) {
  const plan = state.ingestReviews.get(file.name)?.filingPlan;
  if (!hasFilingPlan(plan)) return "";
  const placement = plan.placement || {};
  const whySaved = plan.whySaved || [];
  const candidateFiles = plan.candidateFiles || [];
  const tags = sourceTagsFromFilingPlan(plan);
  const promotion = plan.promotion || {};
  return `
    <div class="run-filing-plan run-brief">
      <div class="run-brief-head">
        <span class="run-kicker">Filing judgment</span>
        ${placement.bucket ? `<span class="run-plan-bucket">${escapeHtml(placement.bucket)}</span>` : ""}
      </div>
      ${placement.path || placement.reason ? `
        <p class="run-brief-copy">
          ${placement.path ? `<strong>${escapeHtml(placement.path)}</strong>` : ""}
          ${placement.reason ? `${placement.path ? " — " : ""}${escapeHtml(placement.reason)}` : ""}
        </p>
      ` : ""}
      ${whySaved.length ? `
        <ul class="run-brief-points">
          ${whySaved.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      ` : ""}
      ${tags.length ? `
        <div class="connection-chip-list plan-chip-list" aria-label="Proposed tags">
          ${tags.slice(0, 10).map((tag) => `<span class="connection-chip">${escapeHtml(tag)}</span>`).join("")}
        </div>
      ` : ""}
      ${candidateFiles.length ? `
        <div class="plan-files">
          <span class="run-kicker">Files Margins checked</span>
          ${candidateFiles.slice(0, 5).map((item) => `
            <div class="plan-file-row">
              <strong>${escapeHtml(item.path)}</strong>
              ${item.reason ? `<span>${escapeHtml(item.reason)}</span>` : ""}
            </div>
          `).join("")}
        </div>
      ` : ""}
      ${plan.typeTagNote ? `<p class="run-note">${escapeHtml(plan.typeTagNote)}</p>` : ""}
      ${promotion.candidate || promotion.recommendation ? `
        <p class="run-note">${escapeHtml([promotion.candidate, promotion.recommendation, promotion.reason].filter(Boolean).join(" — "))}</p>
      ` : ""}
    </div>
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
  const review = state.ingestReviews.get(file.name);
  const fullSummary = sourceIngestFullSummary(file);
  const summaryBullets = sourceIngestSummaryBullets(file);
  const expanded = state.expandedSummaries.has(file.name);
  const canExpand = fullSummary.length > 240 || summaryBullets.length > 3 || (review?.takeaways?.length || 0) > 3;
  const visibleSummary = expanded || !canExpand ? fullSummary : clampSentence(fullSummary, 240);
  const visibleBullets = expanded ? summaryBullets : summaryBullets.slice(0, 3);
  const visibleTakeaways = review?.takeaways?.length
    ? (expanded ? review.takeaways : review.takeaways.slice(0, 3))
    : [];
  return `
    <div class="run-summary run-brief ${expanded ? "expanded" : ""}">
      <div class="run-summary-head run-brief-head">
        <span class="run-kicker">Summary</span>
        ${canExpand ? `<button class="text-toggle" type="button" data-summary-toggle="${escapeHtml(file.name)}">${expanded ? "Show less" : "Show more"}</button>` : ""}
      </div>
      ${visibleTakeaways.length ? renderTakeawayBrief(visibleSummary, visibleTakeaways) : renderSummaryBrief(visibleSummary, visibleBullets)}
    </div>
  `;
}

function renderTakeawayBrief(summary, takeaways = []) {
  return `
    ${summary ? `<p class="run-brief-copy">${escapeHtml(summary)}</p>` : ""}
    <ul class="run-brief-points">
      ${takeaways.map((item) => `
        <li>
          <strong>${escapeHtml(takeawayPrefix(item))}</strong>${escapeHtml(item.point)}
          ${item.whyItMatters ? `<span> ${escapeHtml(item.whyItMatters)}</span>` : ""}
        </li>
      `).join("")}
    </ul>
  `;
}

function takeawayPrefix(item) {
  const label = item.label || {
    primary: "Primary",
    secondary: "Secondary",
    context: "Context"
  }[item.relevance] || "Takeaway";
  return `${label}: `;
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

function renderSourceFinancialDetails(file) {
  const details = state.ingestReviews.get(file.name)?.financialDetails;
  if (!hasFinancialDetails(details)) return "";
  return `
    <div class="run-connections connection-strip">
      <span class="run-kicker">Financial details</span>
      ${details.accounts?.length ? `
        <ul class="run-brief-points">
          ${details.accounts.slice(0, 3).map((account) => `<li>${escapeHtml(financialAccountLine(account))}</li>`).join("")}
        </ul>
      ` : ""}
      ${details.figures?.length ? `
        <div class="connection-chip-list">
          ${details.figures.slice(0, 6).map((figure) => `
            <span class="connection-chip" title="${escapeHtml(figure.context || figure.date || figure.label || "Visible source figure.")}">
              ${escapeHtml([figure.label || "Figure", figure.value, figure.date].filter(Boolean).join(" · "))}
            </span>
          `).join("")}
        </div>
      ` : ""}
      ${details.holdings?.length ? `
        <ul class="run-brief-points">
          ${details.holdings.slice(0, 4).map((holding) => `<li>${escapeHtml(financialHoldingLine(holding))}</li>`).join("")}
        </ul>
      ` : ""}
      ${details.transactions?.length ? `
        <ul class="run-brief-points">
          ${details.transactions.slice(0, 4).map((transaction) => `<li>${escapeHtml(financialTransactionLine(transaction))}</li>`).join("")}
        </ul>
      ` : ""}
      ${details.caveats?.length ? `<p class="run-brief-copy">${escapeHtml(details.caveats.slice(0, 2).join(" "))}</p>` : ""}
    </div>
  `;
}


function renderSourceLightTouch(file) {
  const notes = state.ingestReviews.get(file.name)?.lightTouch || [];
  if (notes.length === 0) return "";
  return `
    <div class="run-connections connection-strip">
      <span class="run-kicker">Light touch</span>
      <ul class="run-brief-points">
        ${notes.slice(0, 2).map((item) => `<li>${escapeHtml(item.note)}${item.reason ? ` ${escapeHtml(item.reason)}` : ""}</li>`).join("")}
      </ul>
    </div>
  `;
}

function renderSourcePropagation(file) {
  const propagation = state.ingestReviews.get(file.name)?.propagation || [];
  if (propagation.length === 0) return "";
  return `
    <div class="run-connections connection-strip">
      <span class="run-kicker">Proposed updates</span>
      <div class="connection-chip-list">
        ${propagation.slice(0, 3).map((item) => `
          <span class="connection-chip" title="${escapeHtml(item.rationale || item.targetPath || "Proposed vault update.")}">
            ${escapeHtml([item.targetPath || "source note", item.action].filter(Boolean).join(" · "))}
          </span>
        `).join("")}
      </div>
    </div>
  `;
}

function questionOptionsWithSkip(question) {
  const options = question.options?.length ? question.options : ["Yes", "No", "Use default"];
  const optionsWithSkip = options.some((option) => String(option).toLowerCase() === "skip")
    ? options
    : [...options, "Skip"];
  return uniqueBy(optionsWithSkip.map((option) => displayQuestionOption(question, option)).filter((option) => option.value), (option) => option.value.toLowerCase());
}

function sourceIngestSummary(file) {
  return clampSentence(sourceIngestFullSummary(file), 340);
}

function sourceIngestFullSummary(file) {
  const review = state.ingestReviews.get(file.name);
  if (review?.summary) return stripTrailingEllipsis(cleanDisplaySummary(review.summary));
  const sourceNote = sourceNoteForFile(file);
  return stripTrailingEllipsis(cleanDisplaySummary(extractSourceSummary(sourceNote) || localSourceSummary(file) || "Margins preserved the source file and prepared it for filing."));
}

function sourceIngestSummaryBullets(file) {
  const review = state.ingestReviews.get(file.name);
  if (review?.summaryBullets?.length) return review.summaryBullets.map((item) => cleanSummary(item)).filter(Boolean);
  const summary = sourceIngestFullSummary(file);
  const parts = summarySentences(summary);
  return parts.length > 2 ? parts.slice(1, 6) : [];
}


function sourceNoteForFile(file) {
  return sourceNoteEntryForFile(file)?.body || "";
}



function installTestHooks() {
  if (!new URLSearchParams(location.search).has("marginsTest")) return;
  globalThis.__marginsTest = {
    seedIngestCard({ summary, questions = [], connections = [], fileName = "browser-smoke-source.txt" } = {}) {
      const file = {
        name: fileName,
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
      const rawPath = rawSourceOutputPath(file.name);
      state.currentFileMap = new Map([
        ["wiki/sources/source-browser-smoke-source.md", `---
type: source
summary: ${JSON.stringify(summary || "")}
raw_file: ${rawPath}
---

# Source: Browser Smoke Source

Original file: \`${rawPath}\`

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
          rawPath,
          question.question,
          question.reason || "Browser smoke question.",
          question.recommendation || "My take: use the best option.",
          question.options || ["Yes", "No", "Skip"]
        ))
      }]]);
      state.ingestAnswers = new Map();
      state.modelTimings = [];
      state.expandedSummaries = new Set();
      state.currentMaterialQuestions = state.ingestReviews.get(file.name).questions;
      renderSources();
      renderVaultTree(state.currentFileMap);
    },
    seedNoisyFilingChecklist() {
      const file = {
        name: "workspace-map-notes.pdf",
        text: "Page 1\nWorkspace map notes.\n\nPage 2\nMore notes.",
        type: "pdf",
        size: 231000,
        pageCount: 2,
        sourceScope: "vault",
        extractionStatus: "extracted",
        extractionError: ""
      };
      const rawPath = rawSourceOutputPath(file.name);
      state.files = [file];
      state.vaultFiles = [{ ...file, sourceScope: "vault", dirtyRaw: false }];
      state.pendingSave = true;
      state.processingInbox = false;
      state.currentFileMap = new Map([
        ["wiki/sources/source-workspace-map-notes.md", `---
type: source
summary: Workspace map notes.
raw_file: ${rawPath}
---

# Source: Workspace Map Notes

Original file: \`${rawPath}\`

## Summary

Notes describe how a workspace map should connect remembered entities to interface decisions.

## Key Terms

- [[know|know]]
- [[think|think]]
- [[things|things]]
- [[going|going]]
- [[thats|thats]]

## Entity Candidates

- [[Some Weak Candidate]]

## Notes

Links: [[display]], [[subjects]], [[results]], [[Workspace Map]], [[Interface Decisions]], [[Graph View]], [[Spatial Memory]], [[Margins UI]]
`],
        ["wiki/concepts/workspace-map.md", "# Workspace Map\n"],
        ["wiki/concepts/interface-decisions.md", "# Interface Decisions\n"],
        ["wiki/concepts/graph-view.md", "# Graph View\n"],
        ["wiki/concepts/spatial-memory.md", "# Spatial Memory\n"],
        ["wiki/projects/margins-ui.md", "# Margins UI\n"]
      ]);
      state.loadedFileMap = new Map([
        ["wiki/concepts/workspace-map.md", "# Workspace Map\n"],
        ["wiki/concepts/interface-decisions.md", "# Interface Decisions\n"],
        ["wiki/concepts/graph-view.md", "# Graph View\n"],
        ["wiki/concepts/spatial-memory.md", "# Spatial Memory\n"],
        ["wiki/projects/margins-ui.md", "# Margins UI\n"]
      ]);
      state.ingestReviews = new Map([[file.name, {
        source: "api",
        provider: "gemini",
        status: "Margins found no required follow-up questions.",
        summary: "Notes describe how a workspace map should connect remembered entities to interface decisions.",
        connections: [],
        questions: []
      }]]);
      state.ingestErrors = new Map();
      renderSources();
      return document.querySelector("#source-list")?.innerText || "";
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
    modelTimings() {
      return state.modelTimings.map(publicModelTiming);
    },
    processTimings() {
      return state.processTimings.map(publicProcessTiming);
    },
    clearModelTimings() {
      state.modelTimings = [];
      try {
        localStorage.removeItem(STORAGE_KEYS.modelTimings);
      } catch {
        // Best-effort test/debug helper.
      }
    },
    clearProcessTimings() {
      state.processTimings = [];
      state.activeProcessTimings = new Map();
      try {
        localStorage.removeItem(STORAGE_KEYS.processTimings);
      } catch {
        // Best-effort test/debug helper.
      }
    },
    setApiRequestTimeout(ms) {
      apiRequestTimeoutMs = Math.max(1, Number(ms) || API_REQUEST_TIMEOUT_MS);
    },
    setIngestProgressDelays(delays) {
      ingestProgressStepDelaysMs = Array.isArray(delays) && delays.length
        ? delays.map((delay) => Math.max(0, Number(delay) || 0))
        : INGEST_PROGRESS_STEP_DELAYS_MS;
    },
    showLlmView() {
      activateTab("llm");
      const view = document.getElementById("llm-view");
      return {
        active: view?.classList.contains("active") || false,
        hidden: Boolean(view?.hidden)
      };
    },
    seedGraphTheme(theme = "light") {
      state.theme = theme === "dark" ? "dark" : "light";
      document.documentElement.dataset.theme = state.theme;
      if (els.themeToggle) els.themeToggle.checked = state.theme === "dark";
      updateThemeToggleLabel();
      state.currentFileMap = new Map([
        ["wiki/index.md", `---
type: index
summary: Test graph index.
---

# Index

[[source-one]]
[[setup-efficiency]]
[[margins-ui]]
`],
        ["wiki/sources/source-one.md", `---
type: source
summary: Test source.
---

# Source One

Links to [[setup-efficiency]] and [[connor]].
`],
        ["wiki/concepts/setup-efficiency.md", `---
type: concept
summary: Setup efficiency concept.
---

# Setup Efficiency

Related to [[connor]] and [[margins-ui]].
`],
        ["wiki/projects/margins-ui.md", `---
type: project
summary: Test project.
---

# Margins UI

Project node linked to [[setup-efficiency]].
`],
        ["wiki/entities/connor.md", `---
type: entity
summary: Connor entity.
tags: [person, test]
updated: 2026-05-06
---

# Connor
`]
      ]);
      renderVaultTree(state.currentFileMap);
      drawGraph(graphFromFileMap(state.currentFileMap));
      activateTab("graph");
      const rootStyle = getComputedStyle(document.documentElement);
      const shellStyle = getComputedStyle(document.querySelector(".graph-shell"));
      const wrapStyle = getComputedStyle(document.querySelector(".graph-wrap"));
      const headerStyle = getComputedStyle(document.querySelector(".graph-header"));
      const backdropStyle = getComputedStyle(document.querySelector(".graph-backdrop"));
      const glowStyle = getComputedStyle(document.querySelector(".node-glow"));
      const projectNodeStyle = getComputedStyle(document.querySelector(".graph-node.type-project .node-core"));
      return {
        theme: state.theme,
        pageBg: rootStyle.getPropertyValue("--bg").trim(),
        shellBg: shellStyle.backgroundColor,
        wrapBg: wrapStyle.backgroundColor,
        headerBg: headerStyle.backgroundColor,
        backdropFill: backdropStyle.fill,
        glowOpacity: glowStyle.opacity,
        projectNodeFill: projectNodeStyle.fill
      };
    },
    seedConceptOnlyVault() {
      state.currentFileMap = new Map([
        ["wiki/index.md", `---
type: index
summary: Index page.
---

# Index

[[setup-efficiency]]
`],
        ["wiki/concepts/setup-efficiency.md", `---
type: concept
summary: Improve the user's ability to get useful systems running quickly.
tags: [build, workflow]
updated: 2026-05-06
---

# Setup Efficiency

This page is real concept-backed vault content.
`],
        ["wiki/projects/margins-product.md", `---
type: project
summary: Product parity work for the Margins app.
tags: [build, margins]
updated: 2026-05-05
priority: pinned
next_move: Ship the Claude-style entity card model.
---

# Margins Product

Real project-backed vault content about making Margins usable.
`],
        ["wiki/ideas/networking-plan.md", `---
type: concept
summary: Lightweight follow-up system for people and opportunities.
tags:
  - people
  - workflow
updated: 2026-04-26
---

# Networking Plan

Keep the #people surface moving without losing context.
`],
        ["wiki/sources/source-only.md", `---
type: source
summary: Source page that should not render as an entity card.
---

# Source Only
`]
      ]);
      state.selectedPath = null;
      renderVaultTree(state.currentFileMap);
      renderWikiFiles(state.currentFileMap);
      return document.querySelector("#entity-browser")?.innerText || "";
    },
    seedTypeOverrideEntityVault() {
      state.currentFileMap = new Map([
        ["wiki/index.md", "# Index\n\n[[ej-reynolds]]\n"],
        ["wiki/projects/ej-reynolds.md", `---
type: entity
summary: Acquaintance connected to the Briefly cluster.
tags: [briefly, acquaintance]
updated: 2026-05-06
---

# E.J. Reynolds

E.J. Reynolds is an acquaintance in the Briefly orbit.
`],
        ["wiki/projects/margins-product.md", `---
type: project
summary: Product build work.
tags: [briefly, product]
updated: 2026-05-05
---

# Margins Product
`],
        ["wiki/companies/centric-wm.md", `---
type: company
summary: Wealth management company.
tags: [briefly, company]
updated: 2026-05-04
---

# Centric WM
`]
      ]);
      state.loadedFileMap = new Map(state.currentFileMap);
      state.vaultHandle = createMemoryVaultHandle();
      state.vaultName = "Browser Test Vault";
      state.selectedPath = null;
      state.entityTypePickerPath = "";
      state.files = [];
      state.vaultFiles = [];
      state.pendingSave = false;
      state.processingInbox = false;
      renderSources();
      renderVaultTree(state.currentFileMap);
      renderWikiFiles(state.currentFileMap);
      return document.querySelector("#entity-browser")?.innerText || "";
    },
    wikiBody(path) {
      return state.currentFileMap?.get(normalizeMarginsPath(path)) || "";
    },
    seedCrowdedEntityFacets() {
      const specs = [
        ["wiki/people/bob-casey.md", "person", "Bob Casey", ["briefly", "person", "vibrance/aged"], "Founder relationship attached to Riviera.", "2026-05-06"],
        ["wiki/advisors/mark-loh.md", "advisor", "Mark Loh", ["briefly", "advisor", "vibrance/aged"], "Advisor note for product and sales.", "2026-05-05"],
        ["wiki/companies/centric-wm.md", "company", "Centric WM", ["company", "riviera", "briefly"], "Pilot partner and buyer context.", "2026-05-04"],
        ["wiki/projects/margins-v2.md", "project", "Margins v2", ["briefly", "region/briefly", "vibrance/recent"], "Product build note with next steps.", "2026-05-06"],
        ["wiki/concepts/setup-efficiency.md", "concept", "Setup Efficiency", ["concept", "competitive-analysis", "vibrance/fresh"], "Concept note for faster setup.", "2026-05-03"],
        ["wiki/ideas/pilot-shape.md", "idea", "Pilot Shape", ["briefly", "competitive-analysis"], "Idea note for pilot scope.", "2026-05-02"],
        ["wiki/synthesis/product-map.md", "synthesis", "Product Map", ["concept", "region/briefly"], "Synthesis note across product work.", "2026-05-01"],
        ["wiki/entities/riviera.md", "entity", "Riviera", ["riviera", "vibrance/aged"], "General entity note for Riviera.", "2026-04-30"],
        ["wiki/entities/hub-briefly.md", "hub", "Briefly Hub", ["briefly", "region/briefly"], "Hub note for Briefly context.", "2026-04-29"]
      ];
      state.currentFileMap = new Map([
        ["wiki/index.md", `---
type: index
summary: Crowded entity facet test index.
---

# Index
`],
        ...specs.map(([path, type, title, tags, summary, updated]) => [path, `---
type: ${type}
summary: ${summary}
tags: [${tags.join(", ")}]
updated: ${updated}
---

# ${title}

${summary}
`])
      ]);
      state.entityFilterKind = "all";
      state.entityFilterValue = "";
      state.entityQuery = "";
      state.selectedPath = null;
      renderVaultTree(state.currentFileMap);
      renderWikiFiles(state.currentFileMap);
      return document.querySelector("#entity-controls")?.innerText || "";
    },
    seedManyRecentEntities() {
      const pinned = [
        ["wiki/people/pinned-one.md", "Pinned One", "Pinned relationship one."],
        ["wiki/projects/pinned-two.md", "Pinned Two", "Pinned project two."]
      ];
      const recent = Array.from({ length: 30 }, (_, index) => {
        const number = String(index + 1).padStart(2, "0");
        return [
          `wiki/entities/recent-entity-${number}.md`,
          `Recent Entity ${number}`,
          `Recent entity ${number} summary.`,
          `2026-05-${number}`
        ];
      });
      state.currentFileMap = new Map([
        ["wiki/index.md", `---
type: index
summary: Many recent entity test index.
---

# Index
`],
        ...pinned.map(([path, title, summary], index) => [path, `---
type: entity
summary: ${summary}
tags: [person]
priority: pinned
updated: 2026-05-0${index + 1}
---

# ${title}

${summary}
`]),
        ...recent.map(([path, title, summary, updated]) => [path, `---
type: entity
summary: ${summary}
tags: [company]
updated: ${updated}
---

# ${title}

${summary}
`])
      ]);
      state.entityFilterKind = "all";
      state.entityFilterValue = "";
      state.entityQuery = "";
      resetEntityRecentLimit();
      state.selectedPath = null;
      renderVaultTree(state.currentFileMap);
      renderWikiFiles(state.currentFileMap);
      return document.querySelector("#entity-browser")?.innerText || "";
    },
    async loadBroadWikiVault() {
      const handle = createMemoryVaultHandle();
      await writeTextFile(handle, "wiki/career/riviera.md", `---
type: entity
bucket: career
summary: Career opportunity with product and founder context.
tags: [build, riviera]
updated: 2026-05-06
priority: pinned
next_move: Keep the Riviera relationship warm.
---

# Riviera

Real career note outside the generated entity folders.
`);
      await writeTextFile(handle, "wiki/personal/bob-casey.md", `---
type: entity
bucket: personal
summary: Founder relationship attached to the Riviera opportunity.
tags:
  - people
  - riviera
updated: 2026-05-04
---

# Bob Casey

Person note that should stay loaded when an entity facet is clicked.
`);
      await writeTextFile(handle, "wiki/career/source-2026-05-01-bob-casey.md", `---
type: source
summary: Source note that should not render as an entity card.
tags: [source, riviera]
---

# Source: Bob Casey
`);
      setActiveVault(handle, "Broad Wiki Vault");
      await loadExistingVault(handle);
      return {
        currentFileCount: state.currentFileMap?.size || 0,
        entityText: document.querySelector("#entity-browser")?.innerText || ""
      };
    },
    async loadSourceOnlyWikiVault() {
      const handle = createMemoryVaultHandle();
      await writeTextFile(handle, "wiki/sources/source-filed-note.md", `---
type: source
summary: Source note without a promoted entity page.
raw_file: raw/filed-note.md
---

# Source: Filed Note

This source-only vault should still be browsable from Files.
`);
      await writeTextFile(handle, "wiki/index.md", "# Index\n");
      setActiveVault(handle, "Source Only Wiki Vault");
      await loadExistingVault(handle);
      return {
        currentFileCount: state.currentFileMap?.size || 0,
        filesText: document.querySelector("#wiki-tree")?.innerText || "",
        entityText: document.querySelector("#entity-browser")?.innerText || "",
        statsText: els.stats?.textContent || ""
      };
    },
    async seedEntityPinningVault() {
      const handle = createMemoryVaultHandle();
      await writeTextFile(handle, "wiki/entities/pin-target.md", `---
type: entity
summary: Entity that starts in recently active and can be pinned.
tags: [company]
updated: 2026-05-06
---

# Pin Target

Entity that starts in recently active and can be pinned.
`);
      await writeTextFile(handle, "wiki/entities/pinned-target.md", `---
type: entity
summary: Entity that starts pinned and can be unpinned.
tags: [person]
priority: pinned
updated: 2026-05-05
---

# Pinned Target

Entity that starts pinned and can be unpinned.
`);
      setActiveVault(handle, "Pinning Test Vault");
      await loadExistingVault(handle);
      return {
        currentFileCount: state.currentFileMap?.size || 0,
        entityText: document.querySelector("#entity-browser")?.innerText || ""
      };
    },
    async readVaultText(path) {
      if (!state.vaultHandle) return "";
      return testReadTextFile(state.vaultHandle, path);
    },
    async prepareRememberedVaultReconnect() {
      const handle = createMemoryVaultHandle();
      await writeTextFile(handle, "wiki/projects/reconnect-project.md", `---
type: project
summary: Remembered vault project loaded through the reconnect workflow.
tags: [build, reconnect]
updated: 2026-05-06
priority: pinned
next_move: Confirm reconnect loads the previous vault.
---

# Reconnect Project
`);
      state.vaultHandle = null;
      state.rememberedVaultHandle = handle;
      state.vaultName = "";
      state.currentFileMap = null;
      state.loadedFileMap = new Map();
      state.vaultFiles = [];
      state.files = [];
      state.pendingSave = false;
      state.hasUnsavedEdits = false;
      state.hasSavedCurrent = false;
      updateVaultStatus(`Last vault: ${handle.name}. Click Reconnect to open it.`);
      renderVaultTree(new Map());
      renderWikiFiles(new Map());
      updateWorkflowState();
      return this.workflowSnapshot();
    },
    workflowSnapshot() {
      return {
        workflowButton: els.workflowBtn?.textContent || "",
        workflowGuidance: els.workflowGuidance?.textContent || "",
        vaultStatus: els.vaultStatus?.textContent || "",
        currentFileCount: state.currentFileMap?.size || 0,
        vaultName: state.vaultName || "",
        entityText: document.querySelector("#entity-browser")?.innerText || ""
      };
    },
    graphState() {
      const activeView = [...document.querySelectorAll(".view")]
        .find((view) => view.classList.contains("active"))?.id || "";
      return {
        activeView,
        selectedPath: state.selectedPath || "",
        hoverId: graphView.hoverId,
        selectedId: graphView.selectedId,
        alpha: graphView.alpha,
        transform: { ...graphView.transform },
        nodes: Object.fromEntries(graphView.nodes.map((node) => [
          node.id,
          { x: node.x, y: node.y, vx: node.vx, vy: node.vy }
        ])),
        activeEdges: document.querySelectorAll(".graph-edge.active").length
      };
    },
    movePointerToGraphNode(id) {
      const point = testGraphClientPoint(id);
      dispatchTestGraphPointer("pointermove", point);
      return this.graphState();
    },
    movePointerOutsideGraph() {
      document.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        clientX: 20,
        clientY: 20,
        pointerId: 1
      }));
      return this.graphState();
    },
    wheelGraph(deltaY) {
      const rect = els.graphSvg.getBoundingClientRect();
      els.graphSvg.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        deltaY
      }));
      return this.graphState();
    },
    dragGraphNode(id, dx, dy) {
      const start = testGraphClientPoint(id);
      dispatchTestGraphPointer("pointerdown", start, { buttons: 1 });
      for (let step = 1; step <= 8; step += 1) {
        dispatchTestGraphPointer("pointermove", {
          clientX: start.clientX + (dx * step) / 8,
          clientY: start.clientY + (dy * step) / 8
        }, { buttons: 1 });
      }
      dispatchTestGraphPointer("pointerup", {
        clientX: start.clientX + dx,
        clientY: start.clientY + dy
      });
      return this.graphState();
    },
    clickGraphNode(id) {
      const point = testGraphClientPoint(id);
      dispatchTestGraphPointer("pointerdown", point, { buttons: 1 });
      dispatchTestGraphPointer("pointerup", point);
      return this.graphState();
    },
    async saveWithDeletedGeneratedPath() {
      const handle = createMemoryVaultHandle();
      await writeTextFile(handle, "wiki/sources/old.md", "# Old source\n");
      await writeTextFile(handle, "wiki/sources/kept.md", "# Kept source\n");
      state.vaultHandle = handle;
      state.vaultName = "Browser Test Vault";
      state.vaultFiles = [];
      state.files = [];
      state.editedRawFiles = new Map();
      state.loadedFileMap = new Map([
        ["wiki/sources/old.md", "# Old source\n"],
        ["wiki/sources/kept.md", "# Kept source\n"]
      ]);
      state.currentFileMap = new Map([
        ["wiki/sources/kept.md", "# Kept source updated\n"],
        ["wiki/index.md", "# Index\n"]
      ]);
      state.pendingSave = true;
      state.hasUnsavedEdits = false;
      state.hasSavedCurrent = false;
      state.ingestReviews = new Map();
      state.ingestAnswers = new Map();
      state.ingestErrors = new Map();
      els.reviewReply.value = "";
      await saveCurrentVault();
      return {
        oldExists: await testFileExists(handle, "wiki/sources/old.md"),
        keptBody: await testReadTextFile(handle, "wiki/sources/kept.md"),
        loadedHasOld: state.loadedFileMap.has("wiki/sources/old.md"),
        pendingSave: state.pendingSave
      };
    },
    async importSourceAndReloadFromRaw() {
      const handle = createMemoryVaultHandle();
      await scaffoldVault(handle);
      await writeTextFile(handle, "wiki/sources/source-existing.md", `---
type: source
summary: Existing source.
raw_file: raw/existing.md
---

# Source: Existing
`);
      setActiveVault(handle, "Browser Test Vault");
      state.currentFileMap = await readVaultFileMap(handle);
      state.loadedFileMap = new Map(state.currentFileMap);
      state.vaultFiles = await readRawSourcesFromVault(handle);
      state.files = [];
      state.pendingSave = false;
      state.processingInbox = false;
      state.ingestReviews = new Map();
      state.ingestAnswers = new Map();
      state.ingestErrors = new Map();

      await setSourceFiles([
        new File(["Persisted source body\n"], "incoming-note.md", {
          type: "text/markdown",
          lastModified: new Date(2026, 4, 5, 15, 30).getTime()
        })
      ]);

      const rawBody = await testReadTextFile(handle, "raw/incoming-note.md");
      const legacyRawExists = await testFileExists(handle, "raw_sources/incoming-note.md");
      const savedBeforeReload = state.vaultFiles.map((file) => file.name);
      const scopeBeforeReload = state.files[0]?.sourceScope || "";

      state.files = [];
      state.vaultFiles = [];
      state.currentFileMap = null;
      state.loadedFileMap = new Map();
      state.pendingSave = false;
      state.processingInbox = false;
      state.ingestReviews = new Map();
      state.ingestAnswers = new Map();
      state.ingestErrors = new Map();

      await loadExistingVault(handle);

      return {
        rawBody,
        legacyRawExists,
        savedBeforeReload,
        scopeBeforeReload,
        pendingAfterReload: state.files.map((file) => file.name),
        sourceScopeAfterReload: state.files[0]?.sourceScope || "",
        sourceListText: document.querySelector("#source-list")?.innerText || ""
      };
    },
    async importCalendarInviteSource() {
      const handle = createMemoryVaultHandle();
      await scaffoldVault(handle);
      setActiveVault(handle, "Browser Test Vault");
      state.currentFileMap = await readVaultFileMap(handle);
      state.loadedFileMap = new Map(state.currentFileMap);
      state.vaultFiles = await readRawSourcesFromVault(handle);
      state.files = [];
      state.pendingSave = false;
      state.processingInbox = false;
      state.apiSecret = "test-gemini-key";
      state.ingestReviews = new Map();
      state.ingestAnswers = new Map();
      state.ingestErrors = new Map();

      const calendarText = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Margins Browser Test//EN",
        "BEGIN:VEVENT",
        "UID:margins-calendar-test",
        "DTSTART:20260413T170000Z",
        "DTEND:20260413T180000Z",
        "SUMMARY:Discussion with Connor",
        "DESCRIPTION:Webex calendar invite for the Fabrizio thread.",
        "END:VEVENT",
        "END:VCALENDAR"
      ].join("\r\n");

      await setSourceFiles([
        new File([calendarText], "invite.ics", {
          type: "text/calendar",
          lastModified: new Date(2026, 3, 12, 21, 42).getTime()
        })
      ]);

      const imported = state.files[0] || {};
      return {
        fileType: imported.type || "",
        fileText: imported.text || "",
        sourceListText: document.querySelector("#source-list")?.innerText || "",
        rawBody: await testReadTextFile(handle, "raw/invite.ics")
      };
    },
    seedTextModelSources(count = 3) {
      state.files = Array.from({ length: count }, (_, index) => ({
        name: `model-source-${index + 1}.txt`,
        text: `Readable source ${index + 1} with enough context for a model-generated filing review.`,
        type: "text",
        size: 74,
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
      state.modelTimings = [];
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
          text: "Unfiled source file exists in raw/ but has not been processed into wiki sources yet.",
          type: "text",
          size: 82,
          lastModified: new Date(2026, 4, 5, 18, 0).getTime(),
          sourceScope: "vault",
          extractionStatus: "ready",
          extractionError: ""
        }
      ];
      const fileMap = new Map([
        ["wiki/sources/source-filed-note.md", `---
type: source
summary: Filed note.
raw_file: raw/filed-note.md
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
    seedActivitySections() {
      const rawFiles = [
        {
          name: "filed-note.md",
          text: "Filed note already has a generated source note and should appear only in recent activity.",
          type: "text",
          size: 86,
          sourceScope: "vault",
          extractionStatus: "ready",
          extractionError: ""
        },
        {
          name: "unfiled-note.md",
          text: "Unfiled source file exists in raw/ but has not been processed into wiki sources yet.",
          type: "text",
          size: 82,
          lastModified: new Date(2026, 4, 5, 18, 0).getTime(),
          sourceScope: "vault",
          extractionStatus: "ready",
          extractionError: ""
        }
      ];
      const longClaudeBody = Array.from({ length: 90 }, (_, index) => (
        `Scroll check line ${index + 1}: Files view content should remain readable while the document pane scrolls.`
      )).join("\n");
      const fileMap = new Map([
        ["CLAUDE.md", `# CLAUDE.md

Read this before operating the vault.

${longClaudeBody}
`],
        ["operator-manual.md", "# Operator Manual\n\nUse this to operate the vault.\n"],
        ["query-cookbook.md", "# Query Cookbook\n\nUse this to query the vault.\n"],
        ["commands/query.md", "# Query\n\nAnswer questions against the vault.\n"],
        ["agents/wiki-ingest.md", "# Wiki Ingest Agent\n\nIngest conservatively.\n"],
        ["wiki/projects/source-2026-05-06-filed-note.md", `---
type: source
bucket: projects
summary: Filed note about Briefly and Margins activity sections.
tags: [source, margins, briefly]
created: 2026-05-06
updated: 2026-05-06
event_date: 2026-05-06
raw_file: raw/filed-note.md
---

# Source: Filed Activity Note

Original file: \`raw/filed-note.md\`

## Summary

Filed note about [[briefly]] and the Margins activity sections.
`],
        ["wiki/ideas/source-2026-05-05-older-note.md", `---
type: source
bucket: ideas
summary: Older source note kept in the recent activity feed.
tags: [source, ideas]
created: 2026-05-05
updated: 2026-05-05
event_date: 2026-05-05
---

# Source: Older Activity Note

## Summary

Older note connected to [[briefly]].
`],
        ["wiki/projects/briefly.md", `---
type: project
summary: Briefly project page.
tags: [project]
updated: 2026-05-06
---

# Briefly

Briefly is a project page used by the Activity test.
`],
        ["wiki/index.md", "# Index\n"]
      ]);
      state.vaultFiles = rawFiles;
      state.files = pendingRawSourcesFromVault(fileMap, rawFiles);
      state.currentFileMap = fileMap;
      state.loadedFileMap = new Map(fileMap);
      state.selectedPath = null;
      state.selectedKind = "";
      state.pendingSave = false;
      state.processingInbox = false;
      state.ingestReviews = new Map();
      state.ingestAnswers = new Map();
      renderSources();
      renderVaultTree(fileMap);
      renderWikiFiles(fileMap);
      return {
        pendingText: document.querySelector("#source-list")?.innerText || "",
        recentText: document.querySelector("#recent-activity-list")?.innerText || ""
      };
    },
    seedDreamBrokenLinks(options = {}) {
      const fileMap = new Map([
        ["CLAUDE.md", "# CLAUDE.md\n\nLocal-first. Proposal-first. No silent write-back.\n"],
        ["operator-manual.md", "# Operator Manual\n\nPrefer source-cited facts and conservative edits.\n"],
        ["query-cookbook.md", "# Query Cookbook\n\nUse exact paths and durable wiki links.\n"],
        ["agents/wiki-editor.md", "# Wiki Editor Agent\n\nPropose structured edits without silent mutation.\n"],
        ["agents/source-auditor.md", "# Source Auditor\n\nCheck whether claims are supported by source citations.\n"],
        ["wiki/index.md", "# Index\n\n[[project-home]]\n"],
        ["wiki/_templates/entity.md", "# Entity Name\n\n- [[source-slug]] - one-line note about what this source established.\n"],
        ["wiki/projects/project-home.md", `---
type: project
summary: Project home page with a broken advisor link.
---

# Project Home

This project references [[Missing Advisor]] and [[Known Company]].
`],
        ["wiki/entities/known-company.md", `---
type: company
summary: Known company entity.
---

# Known Company
`]
      ]);
      if (options.suggestedTarget) {
        fileMap.set("wiki/entities/missing-advisor-profile.md", `---
type: person
summary: Existing advisor page that should receive the missing advisor link.
---

# Missing Advisor Profile
`);
      }
      if (options.largeBrokenSource) {
        fileMap.set("wiki/personal/source-2026-04-26-friends-catchup.md", `---
type: source
bucket: personal
summary: Long friends catchup note with one broken advisor link.
---

# Source: Friends Catchup

${Array.from({ length: 180 }, (_, index) => `Context paragraph ${index + 1}: Matt and Ben discussed the project history, introductions, and follow-up notes without creating a durable entity.`).join("\n\n")}

The long note eventually references [[Missing Advisor]] during a sidebar.

${Array.from({ length: 120 }, (_, index) => `Later context ${index + 1}: More source detail that should not be rewritten just to repair one link.`).join("\n\n")}
`);
      }
      state.vaultFiles = [];
      state.files = [];
      state.currentFileMap = fileMap;
      state.loadedFileMap = new Map(fileMap);
      state.selectedPath = null;
      state.selectedKind = "";
      state.pendingSave = false;
      state.processingInbox = false;
      state.apiSecret = Object.prototype.hasOwnProperty.call(options, "apiSecret") ? options.apiSecret : "test-gemini-key";
      state.ingestReviews = new Map();
      state.ingestAnswers = new Map();
      state.dreamLastRun = null;
      state.dreamReviewActive = false;
      state.dreamSkippedItems = new Set();
      state.dreamDismissedBrokenLinks = new Set();
      renderSources();
      renderVaultTree(fileMap);
      renderWikiFiles(fileMap);
      return dreamBrokenLinks(fileMap).length;
    },
    seedManyRecentActivitySources(count = 30) {
      const yesterdayDate = new Date();
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterday = localDateString(yesterdayDate);
      const fileMap = new Map([
        ["wiki/index.md", "# Index\n"],
        ...Array.from({ length: count }, (_, index) => {
          const number = String(index + 1).padStart(2, "0");
          return [
            `wiki/projects/source-${yesterday}-activity-${number}.md`,
            `---
type: source
bucket: projects
summary: Recent activity source ${number} from yesterday.
tags: [source, margins]
created: ${yesterday}
updated: ${yesterday}
event_date: ${yesterday}
---

# Source: Recent Activity ${number}

## Summary

Recent activity source ${number} from yesterday, connected to [[margins]].
`
          ];
        }),
        ["wiki/projects/margins.md", `---
type: project
summary: Margins project page.
tags: [project]
updated: ${yesterday}
---

# Margins
`]
      ]);
      state.vaultFiles = [];
      state.files = [];
      state.currentFileMap = fileMap;
      state.loadedFileMap = new Map(fileMap);
      state.selectedPath = null;
      state.selectedKind = "";
      state.pendingSave = false;
      state.processingInbox = false;
      state.ingestReviews = new Map();
      state.ingestAnswers = new Map();
      resetActivityRecentLimit();
      renderSources();
      renderVaultTree(fileMap);
      renderWikiFiles(fileMap);
      return {
        cardCount: document.querySelectorAll("#recent-activity-list .activity-card").length,
        recentText: document.querySelector("#recent-activity-list")?.innerText || ""
      };
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
    seedPendingSourceCount(count = 0) {
      const total = Math.max(0, Number(count) || 0);
      state.files = Array.from({ length: total }, (_, index) => ({
        name: `pending-source-${String(index + 1).padStart(2, "0")}.txt`,
        text: `Pending source ${index + 1}`,
        type: "text",
        size: 24,
        lastModified: new Date(2026, 4, 5, 9, index).getTime(),
        sourceScope: "vault",
        extractionStatus: "ready",
        extractionError: ""
      }));
      state.vaultFiles = [];
      state.vaultHandle = createMemoryVaultHandle();
      state.vaultName = "Browser Test Vault";
      state.currentFileMap = new Map([["wiki/index.md", "# Index\n"]]);
      state.pendingSave = false;
      state.processingInbox = false;
      state.ingestReviews = new Map();
      state.ingestErrors = new Map();
      state.ingestAnswers = new Map();
      state.pendingSourceKey = "";
      renderSources();
      updateActionState();
      return document.querySelector("#source-list")?.innerText || "";
    },
    processedReviewNames() {
      const reviewNames = [...state.ingestReviews.keys()];
      return (reviewNames.length ? reviewNames : processedSourceNamesFromFileMap(state.currentFileMap)).sort();
    },
    sourceNoteBody(fileName) {
      const file = state.files.find((source) => source.name === fileName || basename(source.name) === fileName);
      const entry = file ? sourceNoteEntryForFile(file) : null;
      return entry?.body || "";
    },
    sourceNotePath(fileName) {
      const file = state.files.find((source) => source.name === fileName || basename(source.name) === fileName);
      const entry = file ? sourceNoteEntryForFile(file) : null;
      return entry?.path || "";
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
    },
    seedFinancialPdfSource() {
      const file = {
        name: "sarah-coleman-demo/coleman-brokerage-2026-03.pdf",
        text: "Page 1 DEMO charles SCHWAB Schwab One Brokerage Account COLEMAN BROKERAGE 2026-03 SAMPLE CLIENT DATA NOT AN ACTUAL ACCOUNT STATEMENT Account holder: Sarah Coleman Account ending in 4321 Total account value $128,430.52 Cash balance $4,220.17 03/15/2026 Dividend GOOG $125.33 03/20/2026 Transfer from bank $2,500.00 GOOG 12 shares $24,600.00 Member SIPC.",
        type: "pdf",
        size: 42000,
        lastModified: new Date(2026, 4, 5, 14, 23).getTime(),
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
    },
    seedBusinessDocxSource() {
      const file = {
        name: "[2026-04-13] Zoom in on Booth - Marketing and Product Management at Booth.docx",
        text: "Zoom transcript from April 2026. Connor discussed Booth marketing and product management, Amazon account strategy, positioning, and follow-up questions with a prospective team.",
        type: "docx",
        size: 18400,
        lastModified: new Date(2026, 4, 5, 14, 23).getTime(),
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
    },
    seedMotivationalVideoSource() {
      const file = {
        name: "16 Brutal Life Lessons for Ambitious People - Michael Smoak.md",
        text: `---
title: "16 Brutal Life Lessons for Ambitious People - Michael Smoak"
source: "https://www.youtube.com/watch?v=QCifIl5twrY"
author:
  - "Chris Williamson"
published: 2026-04-11
created: 2026-05-03
description: "Michael Smoak is a mindset coach, entrepreneur, and podcaster. What does it actually cost to live a great life? From the outside, top performers seem to have everything we want, but the story isn't that simple."
tags:
  - "clippings"
---

![](https://www.youtube.com/watch?v=QCifIl5twrY)
`,
        type: "md",
        size: 515,
        lastModified: new Date(2026, 4, 5, 14, 23).getTime(),
        browserFile: null,
        sourceScope: "vault",
        extractionStatus: "ready",
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

function testGraphClientPoint(id) {
  const node = graphView.nodes.find((item) => item.id === id);
  if (!node) throw new Error(`Missing graph node: ${id}`);
  const rect = els.graphSvg.getBoundingClientRect();
  return {
    clientX: rect.left + ((node.x * graphView.transform.k + graphView.transform.x) / graphView.width) * rect.width,
    clientY: rect.top + ((node.y * graphView.transform.k + graphView.transform.y) / graphView.height) * rect.height
  };
}

function dispatchTestGraphPointer(type, point, options = {}) {
  els.graphSvg.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: point.clientX,
    clientY: point.clientY,
    pointerId: 1,
    buttons: options.buttons || 0
  }));
}

function processedSourceNamesFromFileMap(fileMap) {
  if (!fileMap) return [];
  const names = [];
  for (const [path, body] of fileMap.entries()) {
    if (!/^wiki\/sources\/source-[^/]+\.md$/.test(path)) continue;
    const rawFile = body.match(/^raw_file:\s*(?:raw|raw_sources)\/(.+)$/m)?.[1]?.trim();
    if (rawFile) names.push(rawFile);
  }
  return names;
}

async function testFileExists(rootHandle, path) {
  try {
    await fileHandleForPath(rootHandle, path, false);
    return true;
  } catch {
    return false;
  }
}

async function testReadTextFile(rootHandle, path) {
  const handle = await fileHandleForPath(rootHandle, path, false);
  return readTextHandle(handle);
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
    entries() {
      return entries.entries();
    },
    async queryPermission() {
      return "granted";
    },
    async requestPermission() {
      return "granted";
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

function allSourceFiles() {
  const byName = new Map();
  for (const file of state.vaultFiles) byName.set(file.name, file);
  for (const file of state.files) byName.set(file.name, file);
  for (const file of state.editedRawFiles.values()) byName.set(file.name, file);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function rawFileForPath(path) {
  const rawName = rawSourceRelativeName(path);
  return allSourceFiles().find((file) => file.name === rawName) || null;
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

async function handleWorkflowButtonClick() {
  const step = workflowStep();
  if (step.disabled) return;
  if (step.action === "vault" || step.action === "reconnectVault") {
    await runWorkflowStep(step);
    return;
  }
  await withBusyOperation(step.label, () => runWorkflowStep(step));
}

async function runWorkflowStep(step = workflowStep()) {
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
  if (activeOperation) {
    return {
      action: "busy",
      label: "Working...",
      guidance: `${activeOperation} is running.`,
      disabled: true
    };
  }

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
        ? "Review the new source against the existing vault, then process the proposed changes."
        : "Review the uploaded files, ask a few filing questions, then process them locally."
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
  return isRawSourcePath(path) ? "raw" : path.startsWith("wiki/") ? "wiki" : "system";
}

function documentKindLabel(kind) {
  return {
    raw: "Source file",
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
  resizeDocEditor();
  syncDocHighlightScroll();
}

function syncDocHighlightScroll() {
  if (!els.docHighlight || !els.docBody) return;
  els.docHighlight.scrollTop = els.docBody.scrollTop;
  els.docHighlight.scrollLeft = els.docBody.scrollLeft;
}

function resizeDocEditor() {
  if (!els.docBody) return;
  els.docBody.style.height = "auto";
  const style = typeof getComputedStyle === "function" ? getComputedStyle(els.docBody) : null;
  const minHeight = parseFloat(style?.minHeight) || 0;
  const nextHeight = Math.max(els.docBody.scrollHeight, minHeight);
  els.docBody.style.height = `${nextHeight}px`;
  if (els.docHighlight) els.docHighlight.style.height = `${nextHeight}px`;
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
  const signalQuestions = localSignalQuestionsForFile(file, mode);
  const questions = [
    ...riskQuestions(currentSourceMap).slice(0, 1),
    ...signalQuestions
  ];
  return limitMaterialQuestions(questions, mode);
}

function localSignalQuestionsForFile(file, mode) {
  if (!file?.name || mode === "auto") return [];
  const text = `${file.name}\n${file.text || ""}`;
  const questions = [];

  if (mode === "strict" && questions.length === 0 && !looksPurelyArchivalSource(text)) {
    questions.push(reviewQuestion(
      "suggest",
      "Priority",
      rawSourceOutputPath(file.name),
      "Is this source important enough to promote beyond a source note?",
      "Strict review should catch meaningful notes that need an entity, concept, task, or follow-up page.",
      "My take: keep it as a source note unless it changes an active project, relationship, or decision.",
      ["Source note only", "Promote it", "Skip"]
    ));
  }

  return questions;
}

function looksPurelyArchivalSource(text) {
  return /\b(receipt|invoice|statement|confirmation|form|policy|manual|terms|archive)\b/i.test(text || "");
}

function currentSourceNoteMap(fileMap, file = null) {
  if (!fileMap || (state.files.length === 0 && !file)) return fileMap || new Map();
  const rawPaths = new Set((file ? [file] : state.files).flatMap((source) => rawSourceCandidatePaths(source.name)));
  const entries = [...fileMap.entries()].filter(([path, body]) => (
    path.startsWith("wiki/sources/") && [...rawPaths].some((rawPath) => body.includes(rawPath))
  ));
  return new Map(entries);
}

function buildAutoFileQuestions(fileMap, warningsByPath) {
  const warningQuestions = [];
  for (const [path, warnings] of warningsByPath.entries()) {
    for (const warning of warnings) {
      if (/contentReference|Missing YAML|not valid JSON|raw source|source file/i.test(warning)) {
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
    "raw/",
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
    const result = await extractPdfText(blob);
    file.text = result.text.trim();
    file.pageCount = result.pageCount;
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

  return {
    text: pages.join("\n\n"),
    pageCount: pdf.numPages
  };
}

function updateActionState() {
  const busy = isBusyOperation();
  const hasFiles = state.files.length > 0;
  const hasPendingPdf = state.files.some((file) => file.type === "pdf" && file.extractionStatus !== "extracted");
  els.extractBtn.disabled = busy || !hasPendingPdf;
  els.compileBtn.disabled = busy || !hasFiles;
  els.llmBtn.disabled = busy || !hasFiles;
  updateSaveButtonState();
  updateWorkflowState();
}

function updateSaveButtonState() {
  const busy = isBusyOperation();
  const canPrepare = state.files.length > 0 && !state.pendingSave;
  const canSave = (state.pendingSave || state.hasUnsavedEdits) && state.currentFileMap;
  if (els.saveVaultBtn) {
    els.saveVaultBtn.disabled = busy || !(canPrepare || canSave);
    els.saveVaultBtn.textContent = busy ? "Working..." : state.processingInbox ? "Processing..." : canSave ? "Write vault" : "Process";
  }
  if (els.bulkIngestBtn) {
    els.bulkIngestBtn.disabled = busy || state.processingInbox || state.files.length === 0;
    els.bulkIngestBtn.textContent = busy || state.processingInbox && !state.processingFileName ? "Processing..." : "Bulk process";
  }
  if (els.docSaveBtn) {
    els.docSaveBtn.disabled = busy || !canSave;
    if (els.docSaveBtn.textContent !== "Saving..." && els.docSaveBtn.textContent !== "Saved") {
      els.docSaveBtn.textContent = "Save";
    }
  }
}

function sourceClass(file) {
  const classes = [`type-${sourceBadgeClass(file)}`];
  if (state.processingInbox && (!state.processingFileName || state.processingFileName === file.name)) classes.push("processing");
  else if (isSourceReviewReady(file)) classes.push("ready-to-write");
  else if (!state.ingestErrors.has(file?.name)) classes.push("pending-ghost");
  return classes.join(" ");
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

function sourceBadgeClass(file) {
  const ext = basename(file?.name || "").split(".").pop()?.toLowerCase() || "";
  if (file?.type === "pdf" || ext === "pdf") return "pdf";
  if (["eml", "msg"].includes(ext)) return "eml";
  if (["mp3", "m4a", "wav", "aac", "aiff"].includes(ext)) return "aud";
  if (["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "tif", "tiff"].includes(ext)) return "img";
  if (file?.type === "docx" || ["doc", "docx"].includes(ext)) return "doc";
  if (["md", "markdown", "txt"].includes(ext)) return "txt";
  return "txt";
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


function activateTab(view) {
  document.querySelectorAll(".tab").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((item) => {
    const active = item.id === `${view}-view`;
    item.classList.toggle("active", active);
    if (item.classList.contains("utility-view")) item.hidden = !active;
  });
  if (view === "graph" && graphView.nodes.length) {
    startGraphSimulation(0.16);
  } else if (view !== "graph" && graphView.raf) {
    stopGraphSimulation();
  }
  if (view === "wiki") {
    requestAnimationFrame(renderDocHighlight);
  }
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


function todayString() {
  return localDateString();
}
