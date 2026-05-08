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
