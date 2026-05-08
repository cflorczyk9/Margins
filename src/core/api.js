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
// JSON-from-LLM parsing utilities
//
// Models occasionally wrap JSON in code fences, emit BOMs, or truncate
// before closing braces. These helpers do best-effort recovery before
// the strict parsers downstream give up.
// ---------------------------------------------------------------------

import { clampSentence } from "./wiki.js";

export function stripJsonCodeFence(text) {
  return String(text || "")
    .trim()
    .replace(/^﻿/, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function hasUnclosedJsonStructure(text) {
  const stack = [];
  let inString = false;
  let escaped = false;
  for (const char of String(text || "")) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char === "{" ? "}" : "]");
      continue;
    }
    if (char === "}" || char === "]") {
      if (char !== stack.pop()) return false;
    }
  }
  return inString || stack.length > 0;
}

export function balancedJsonSubstring(text) {
  const source = String(text || "");
  for (let start = 0; start < source.length; start += 1) {
    const opener = source[start];
    if (opener !== "{" && opener !== "[") continue;
    const closerFor = opener === "{" ? "}" : "]";
    const stack = [closerFor];
    let inString = false;
    let escaped = false;
    for (let index = start + 1; index < source.length; index += 1) {
      const char = source[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }
      if (char === "\"") {
        inString = true;
        continue;
      }
      if (char === "{" || char === "[") {
        stack.push(char === "{" ? "}" : "]");
        continue;
      }
      if (char === "}" || char === "]") {
        const expected = stack.pop();
        if (char !== expected) break;
        if (stack.length === 0) {
          return source.slice(start, index + 1);
        }
      }
    }
  }
  return "";
}

export function parseJsonCandidate(candidate) {
  const stripped = stripJsonCodeFence(candidate);
  const variants = [
    candidate,
    stripped,
    candidate.replace(/,\s*([}\]])/g, "$1"),
    stripped.replace(/,\s*([}\]])/g, "$1")
  ];
  for (const variant of variants) {
    try {
      const parsed = JSON.parse(variant);
      if (typeof parsed === "string") return parseJsonObject(parsed);
      return parsed;
    } catch {
      // Try the next repair variant.
    }
  }
  return null;
}

export function jsonParseCandidates(content) {
  const text = String(content || "").trim();
  if (!text) return [];
  const candidates = new Set([text, stripJsonCodeFence(text)]);
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    candidates.add(match[1].trim());
  }
  const balanced = balancedJsonSubstring(text);
  if (balanced) candidates.add(balanced);
  return [...candidates].filter(Boolean);
}

export function parseJsonObject(content) {
  for (const candidate of jsonParseCandidates(content)) {
    const parsed = parseJsonCandidate(candidate);
    if (parsed && typeof parsed === "object") return parsed;
  }
  return null;
}

export function looksLikeTruncatedJson(content) {
  const text = stripJsonCodeFence(String(content || "").trim());
  if (!/^[{\[]/.test(text)) return false;
  if (parseJsonCandidate(text)) return false;
  return hasUnclosedJsonStructure(text) || /[:,]\s*$/.test(text);
}

export function isGeminiOutputTruncated(candidate, content) {
  return /MAX_TOKENS/i.test(candidate?.finishReason || "") || looksLikeTruncatedJson(content);
}

// ---------------------------------------------------------------------
// Error constructors (paired with the predicates above)
// ---------------------------------------------------------------------

export function modelOutputTruncatedError(provider, content, finishReason = "", outputKind = "") {
  const preview = clampSentence(String(content || "").replace(/\s+/g, " "), 240);
  const reason = finishReason ? ` (${finishReason})` : "";
  const kind = outputKind || (String(content || "").includes("```margins-file") ? "margins-file blocks" : "JSON");
  const subject = kind === "margins-file blocks" ? "helper output" : "review";
  const error = new Error(`Margins ${subject} was cut off before complete ${kind} came back${reason}${preview ? `: ${preview}` : "."}`);
  error.code = "MARGINS_MODEL_OUTPUT_TRUNCATED";
  error.provider = provider;
  error.finishReason = finishReason;
  error.partialContent = String(content || "");
  return error;
}

export function modelJsonParseError(provider, content) {
  if (looksLikeTruncatedJson(content)) {
    return modelOutputTruncatedError(provider, content, "");
  }
  const preview = clampSentence(String(content || "").replace(/\s+/g, " "), 240);
  const error = new Error(`Margins received malformed JSON for the review${preview ? `: ${preview}` : "."}`);
  error.code = "MARGINS_MODEL_JSON_PARSE";
  error.provider = provider;
  return error;
}

// ---------------------------------------------------------------------
// Review questions selector
// ---------------------------------------------------------------------

export function modelQuestionsOrFallback(apiReview) {
  if (apiReview.questions?.length) return apiReview.questions;
  if (apiReview.modelReturnedNoQuestions && apiReview.fallbackQuestions?.length) return apiReview.fallbackQuestions;
  return [];
}
