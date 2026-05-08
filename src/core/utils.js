// General-purpose utilities used across views and core modules.
//
// Kept small intentionally — only helpers that are genuinely
// project-agnostic. Domain-specific helpers belong in core/wiki.js,
// core/api.js, or the relevant view module.

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function hashString(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------
// Loose dict accessors (used widely by the API review parsers, but also
// generic enough to live in utils — same shape as Lodash _.get with
// fuzzy field-name matching for snake_case / camelCase divergence).
// ---------------------------------------------------------------------

export function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

export function normalizedFieldName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function field(value, ...names) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(value, name)) return value[name];
  }
  const normalizedNames = new Set(names.map(normalizedFieldName));
  for (const [key, fieldValue] of Object.entries(value)) {
    if (normalizedNames.has(normalizedFieldName(key))) return fieldValue;
  }
  return undefined;
}

// ---------------------------------------------------------------------
// Numeric and string formatters
// ---------------------------------------------------------------------

export function formatStatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

export function formatUsd(value) {
  return `$${Number(value || 0).toFixed(4).replace(/0+$/, "").replace(/\.$/, ".00")}`;
}

export function formatFileSize(size) {
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

export function textSizeBytes(value) {
  const text = String(value || "");
  try {
    return new TextEncoder().encode(text).length;
  } catch {
    return text.length;
  }
}

export function formatByteSize(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${formatStatNumber(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function formatProcessDuration(milliseconds) {
  const seconds = Math.max(0, Number(milliseconds) || 0) / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
}

export function pluralize(noun, count) {
  if (Number(count) === 1) return noun;
  if (noun === "entity") return "entities";
  return `${noun}${Number(count) === 1 ? "" : "s"}`;
}

export function wordCount(text) {
  return (text.match(/\S+/g) || []).length;
}

export function firstLine(text) {
  return text.split("\n").find((line) => line.trim() && !line.startsWith("#")) || "";
}

export function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export function excerptForQuestion(text, max) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max).trim()}...`;
}

export function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function nextAnimationFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

export function redactEndpoint(endpoint) {
  if (!endpoint) return "";
  try {
    const url = new URL(endpoint);
    url.search = "";
    return url.toString();
  } catch {
    return String(endpoint).replace(/\?.*$/, "");
  }
}
