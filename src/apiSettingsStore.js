const STORAGE_KEY = "margins.apiSettings.v1";

const DEFAULT_SETTINGS = Object.freeze({
  providerLabel: "",
  endpointUrl: "",
  model: "",
  hasApiKey: false,
  maskedApiKey: ""
});

export function apiSettingsStorageKey() {
  return STORAGE_KEY;
}

export function maskSecret(secret) {
  const value = typeof secret === "string" ? secret.trim() : "";
  if (!value) {
    return "";
  }
  if (value.length <= 4) {
    return "*".repeat(value.length);
  }

  const visibleEnd = value.slice(-4);
  const maskedLength = Math.max(4, Math.min(12, value.length - 4));
  return `${"*".repeat(maskedLength)}${visibleEnd}`;
}

export function normalizeApiSettings(settings = {}) {
  const next = {
    providerLabel: stringValue(settings.providerLabel),
    endpointUrl: stringValue(settings.endpointUrl),
    model: stringValue(settings.model),
    hasApiKey: Boolean(settings.hasApiKey),
    maskedApiKey: stringValue(settings.maskedApiKey)
  };

  if (typeof settings.apiKey === "string" && settings.apiKey.trim()) {
    next.hasApiKey = true;
    next.maskedApiKey = maskSecret(settings.apiKey);
  } else if (next.maskedApiKey) {
    next.hasApiKey = true;
  } else if (!next.hasApiKey) {
    next.maskedApiKey = "";
  }

  return next;
}

export function loadApiSettings(storage = getLocalStorage()) {
  if (!storage) {
    return { ...DEFAULT_SETTINGS };
  }

  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) {
    return { ...DEFAULT_SETTINGS };
  }

  try {
    return normalizeApiSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveApiSettings(settings, storage = getLocalStorage()) {
  if (!storage) {
    return false;
  }

  const normalized = normalizeApiSettings(settings);
  storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function clearApiSettings(storage = getLocalStorage()) {
  if (!storage) {
    return false;
  }

  storage.removeItem(STORAGE_KEY);
  return true;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getLocalStorage() {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}
