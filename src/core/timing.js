// Process + model timing telemetry.
//
// Records two parallel logs in localStorage (capped at 100 entries each):
// - process timings: end-to-end ingest pipeline phases (raw saved → text
//   ready → draft ready → review ready → render ready)
// - model timings: API call lifecycle (throttle wait → request round-trip
//   → token usage → ok/error)
//
// Pure persistence + state-bound singletons. Three host callbacks needed
// (set via initTimingModule):
//   - isSourceReviewReady(file): whether a file's review is approveable
//   - renderSources(): re-render the inbox source list
//   - sourceAttachmentMimeType(file): canonical MIME for telemetry tagging
//
// Reads/writes:
//   state.activeProcessTimings  — Map<fileName, record> while in flight
//   state.processTimings        — Array<record> persisted log
//   state.modelTimings          — Array<record> persisted log
//   state.ingestReviews / state.ingestErrors (read-only)

import { STORAGE_KEYS } from "../storageKeys.js";
import { state } from "./state.js";
import { clampSentence, cleanSummary } from "./wiki.js";
import { nextAnimationFrame, redactEndpoint, safeNumber } from "./utils.js";

// ---------------------------------------------------------------------
// Host wiring
// ---------------------------------------------------------------------

let callbacks = {
  isSourceReviewReady: () => false,
  renderSources: () => {},
  sourceAttachmentMimeType: () => ""
};

export function initTimingModule(deps) {
  callbacks = { ...callbacks, ...(deps?.callbacks || {}) };
}

// ---------------------------------------------------------------------
// Process timing
// ---------------------------------------------------------------------

export function beginProcessTimings(files = [], { action = "single", autoFile = false } = {}) {
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

export function beginProcessTimingRecord(file, {
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

export function markProcessTimingPhase(files = [], fieldName = "") {
  if (!fieldName) return;
  const now = performance.now();
  for (const file of files) {
    const record = state.activeProcessTimings.get(file?.name || "");
    if (!record || record[fieldName]) continue;
    record[fieldName] = Math.max(0, Math.round(now - record.startedAtMs));
  }
}

export async function finishProcessTimingsAfterRender(files = [], { error = null, autoFile = false } = {}) {
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
  if (!autoFile && records.some(({ file }) => callbacks.isSourceReviewReady(file))) callbacks.renderSources();
}

export function finishProcessTiming(file, record, { error = null, autoFile = false } = {}) {
  const now = performance.now();
  const review = state.ingestReviews.get(file?.name || "");
  const readyToApprove = Boolean(file && callbacks.isSourceReviewReady(file));
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

export function publicProcessTiming(record) {
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

export function loadProcessTimingLog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.processTimings) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeStoredProcessTiming).filter(Boolean).slice(-100) : [];
  } catch {
    return [];
  }
}

export function normalizeStoredProcessTiming(record) {
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

export function saveProcessTimingLog() {
  trimProcessTimingLog();
  try {
    localStorage.setItem(STORAGE_KEYS.processTimings, JSON.stringify(state.processTimings.map(publicProcessTiming)));
  } catch {
    // Local timing diagnostics should never block ingest or approval.
  }
}

export function trimProcessTimingLog() {
  if (state.processTimings.length > 100) {
    state.processTimings.splice(0, state.processTimings.length - 100);
  }
}

export function latestProcessTimingForFile(fileName) {
  if (!fileName) return null;
  for (let index = state.processTimings.length - 1; index >= 0; index -= 1) {
    const record = state.processTimings[index];
    if (record.fileName === fileName) return record;
  }
  return null;
}

export function processTimingErrorLabel(error) {
  if (!error) return "";
  if (typeof error === "string") return clampSentence(error, 180);
  return clampSentence(error.message || String(error), 180);
}

// ---------------------------------------------------------------------
// Model timing
// ---------------------------------------------------------------------

export function beginModelTiming({
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

export function finishModelTiming(record, { ok, usage = {}, contentChars = 0, error = null } = {}) {
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

export function markModelTimingParseFailure(record, error) {
  if (!record) return null;
  record.parseOk = false;
  record.error = modelTimingErrorLabel(error);
  saveModelTimingLog();
  return record;
}

export function publicModelTiming(record) {
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

export function modelTimingSourceMetadata(file, fileMap) {
  const browserSize = Number(file?.browserFile?.size || 0);
  const fileSize = Number(file?.size || 0);
  return {
    sourceType: file?.type || "",
    sourceScope: file?.sourceScope || "",
    sourceMimeType: callbacks.sourceAttachmentMimeType(file),
    sourceSizeBytes: Number.isFinite(browserSize) && browserSize > 0 ? browserSize : Number.isFinite(fileSize) ? fileSize : 0,
    sourceTextChars: String(file?.text || "").length,
    vaultContextFileCount: fileMap?.size || 0
  };
}

export function modelTimingErrorLabel(error) {
  if (!error) return "";
  const status = error.status ? `HTTP ${error.status}: ` : "";
  return clampSentence(`${status}${error.message || error}`, 180);
}

export function geminiAttachmentBytes(extraParts = []) {
  return extraParts.reduce((total, part) => {
    const data = part?.inline_data?.data || part?.inlineData?.data || "";
    return total + base64ByteLength(data);
  }, 0);
}

export function base64ByteLength(value) {
  const clean = String(value || "").replace(/\s+/g, "");
  if (!clean) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(clean.length * 3 / 4) - padding);
}

export function loadModelTimingLog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.modelTimings) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeStoredModelTiming).filter(Boolean).slice(-100) : [];
  } catch {
    return [];
  }
}

export function normalizeStoredModelTiming(record) {
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

export function saveModelTimingLog() {
  trimModelTimingLog();
  try {
    localStorage.setItem(STORAGE_KEYS.modelTimings, JSON.stringify(state.modelTimings.map(publicModelTiming)));
  } catch {
    // Timing logs are best-effort diagnostics; never block ingest on storage quota or privacy settings.
  }
}

export function trimModelTimingLog() {
  if (state.modelTimings.length > 100) {
    state.modelTimings.splice(0, state.modelTimings.length - 100);
  }
}

export function elapsedSince(startedAtMs) {
  return Math.max(0, Math.round(performance.now() - startedAtMs));
}
