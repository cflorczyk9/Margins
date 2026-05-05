import assert from "node:assert/strict";
import test from "node:test";
import {
  apiSettingsStorageKey,
  clearApiSettings,
  loadApiSettings,
  maskSecret,
  normalizeApiSettings,
  saveApiSettings
} from "../src/apiSettingsStore.js";

test("maskSecret hides short and long values without revealing the full secret", () => {
  assert.equal(maskSecret(""), "");
  assert.equal(maskSecret("abc"), "***");
  assert.equal(maskSecret("test-key-1234"), "*********1234");
});

test("normalizeApiSettings stores only sanitized API key status", () => {
  const normalized = normalizeApiSettings({
    providerLabel: "  Local  ",
    endpointUrl: " http://localhost:11434/v1 ",
    model: " filing-helper ",
    apiKey: "unit-test-key-1234"
  });

  assert.deepEqual(normalized, {
    providerLabel: "Local",
    endpointUrl: "http://localhost:11434/v1",
    model: "filing-helper",
    hasApiKey: true,
    maskedApiKey: "************1234"
  });
  assert.equal(Object.hasOwn(normalized, "apiKey"), false);
});

test("loadApiSettings and saveApiSettings round-trip through storage", () => {
  const storage = createMemoryStorage();
  const saved = saveApiSettings({
    providerLabel: "OpenAI-compatible",
    endpointUrl: "https://example.invalid/v1",
    model: "questions-model",
    hasApiKey: true,
    maskedApiKey: "********0000"
  }, storage);

  assert.equal(saved.hasApiKey, true);
  assert.deepEqual(loadApiSettings(storage), saved);
  assert.match(storage.getItem(apiSettingsStorageKey()), /"maskedApiKey"/);
  assert.doesNotMatch(storage.getItem(apiSettingsStorageKey()), /unit-test-key/);

  assert.equal(clearApiSettings(storage), true);
  assert.equal(loadApiSettings(storage).hasApiKey, false);
});

test("loadApiSettings tolerates missing, unavailable, and malformed storage", () => {
  assert.deepEqual(loadApiSettings(null), {
    providerLabel: "",
    endpointUrl: "",
    model: "",
    hasApiKey: false,
    maskedApiKey: ""
  });

  const storage = createMemoryStorage();
  storage.setItem(apiSettingsStorageKey(), "{");
  assert.equal(loadApiSettings(storage).maskedApiKey, "");
});

function createMemoryStorage() {
  const items = new Map();
  return {
    getItem(key) {
      return items.has(key) ? items.get(key) : null;
    },
    setItem(key, value) {
      items.set(key, String(value));
    },
    removeItem(key) {
      items.delete(key);
    }
  };
}
