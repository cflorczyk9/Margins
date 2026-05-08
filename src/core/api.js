// Pure API helpers extracted from app.js.
//
// Scope (Phase 3 of the module-split refactor):
//   - Numeric coercion guards used by provider/guard config
//   - API provider identity helpers (label/value/default model/default
//     endpoint/secret-requirement)
//   - .env parser used to seed local API secrets in dev
//   - Spend-guard settings: defaults, normalization, persistence
//   - Empty API usage struct
//   - modelQuestionsOrFallback (pure review-questions selector)
//
// Out of scope (intentionally still in app.js):
//   - DOM-touching API hydration/render functions (hydrateApiControls,
//     saveApiControls, clearApiControls, renderApiStatus, hydrateApi-
//     GuardControls, saveApiGuardControls, resetApiUsage, renderApi-
//     GuardStatus, hydrateLocalEnvApiSecret, ensureApiSecretReady).
//     These need access to the `els` DOM cache and will move when
//     `els` is extracted.
//   - Error classifiers (isRateLimitError, isSpendGuardError, isModel-
//     JsonParseError, isModelOutputTruncatedError) and constructors
//     (modelJsonParseError, modelOutputTruncatedError) — coupled to
//     looksLikeTruncatedJson + clampSentence string helpers; defer.
//   - parseApiIngestReview — pulls a large sub-graph of review parsers
//     (parseMissionFrame, parseTakeaways, parseFilingPlan, etc.); moves
//     with the ingest pipeline in a later phase.

import { STORAGE_KEYS } from "../storageKeys.js";

// ---------------------------------------------------------------------
// Numeric coercion
// ---------------------------------------------------------------------

export function positiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function positiveNumber(value, fallback) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function nonNegativeNumber(value, fallback) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function formatControlNumber(value) {
  return Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 1
  });
}

// ---------------------------------------------------------------------
// Provider identity
// ---------------------------------------------------------------------

export function providerValue(label) {
  const value = String(label || "").toLowerCase();
  if (value.includes("gemini") || value.includes("google")) return "gemini";
  if (value.includes("anthropic")) return "anthropic";
  if (value.includes("local")) return "local";
  if (value.includes("openai")) return "openai";
  return value;
}

export function providerLabel(value) {
  return {
    gemini: "Gemini",
    openai: "OpenAI",
    anthropic: "Anthropic",
    local: "Local model"
  }[value] || "Gemini";
}

export function defaultModelForProvider(provider) {
  return {
    gemini: "gemini-2.5-flash",
    openai: "gpt-5-mini",
    anthropic: "claude-3-5-haiku-latest",
    local: "local-filing-helper"
  }[provider] || "gemini-2.5-flash";
}

export function defaultEndpointForProvider(provider) {
  return {
    gemini: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    openai: "https://api.openai.com/v1/chat/completions",
    anthropic: "https://api.anthropic.com/v1/messages",
    local: "http://localhost:11434/v1/chat/completions"
  }[provider] || "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent";
}

export function apiProviderRequiresSecret(provider) {
  return provider !== "local";
}

// ---------------------------------------------------------------------
// .env parsing (used by hydrateLocalEnvApiSecret)
// ---------------------------------------------------------------------

export function parseDotEnv(text) {
  const env = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    env[key.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

// ---------------------------------------------------------------------
// Spend guard settings + usage
// ---------------------------------------------------------------------

export function defaultApiGuardSettings() {
  return {
    enabled: true,
    maxRequests: 20,
    maxOutputTokens: 8192,
    maxSessionTokens: 250000,
    maxSessionUsd: 1,
    minRequestDelaySeconds: 2,
    maxRequestsPerWindow: 3,
    requestWindowSeconds: 10
  };
}

export function normalizeApiGuardSettings(settings = {}) {
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

export function loadApiGuardSettings() {
  try {
    return normalizeApiGuardSettings(JSON.parse(localStorage.getItem(STORAGE_KEYS.apiGuard) || "{}"));
  } catch {
    return defaultApiGuardSettings();
  }
}

export function emptyApiUsage() {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedUsd: 0
  };
}

// ---------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------

export function isRateLimitError(error) {
  return Number(error?.status) === 429 || /rate limit|rate-limited|quota|resource exhausted|free-tier limit|limit reached|HTTP 429/i.test(`${error?.message || error || ""}`);
}

export function isSpendGuardError(error) {
  return error?.code === "MARGINS_SPEND_GUARD" || /spend guard stopped/i.test(`${error?.message || error || ""}`);
}

export function isModelJsonParseError(error) {
  return error?.code === "MARGINS_MODEL_JSON_PARSE";
}

export function isModelOutputTruncatedError(error) {
  return error?.code === "MARGINS_MODEL_OUTPUT_TRUNCATED";
}

export function retryAfterText(error) {
  if (!error?.retryAfter) return "Wait a minute, then ";
  const seconds = Number(error.retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return `Wait about ${Math.ceil(seconds)} seconds, then `;
  return "";
}

// ---------------------------------------------------------------------
// Review questions selector
// ---------------------------------------------------------------------

export function modelQuestionsOrFallback(apiReview) {
  if (apiReview.questions?.length) return apiReview.questions;
  if (apiReview.modelReturnedNoQuestions && apiReview.fallbackQuestions?.length) return apiReview.fallbackQuestions;
  return [];
}
