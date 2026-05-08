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
