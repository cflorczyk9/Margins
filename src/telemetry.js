import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const DEFAULT_ENDPOINT = "https://margins.goatcounter.com";
const CONSENT_PATH = path.join(os.homedir(), ".margins", "consent.json");
const REQUEST_TIMEOUT_MS = 2000;

export function consentFilePath() {
  return CONSENT_PATH;
}

export async function readConsent() {
  try {
    const text = await readFile(CONSENT_PATH, "utf8");
    return JSON.parse(text);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    return null;
  }
}

export async function writeConsent({ enabled, endpoint }) {
  await mkdir(path.dirname(CONSENT_PATH), { recursive: true });
  const record = {
    enabled: Boolean(enabled),
    endpoint: endpoint || DEFAULT_ENDPOINT,
    choseAt: new Date().toISOString()
  };
  await writeFile(CONSENT_PATH, JSON.stringify(record, null, 2) + "\n", "utf8");
  return record;
}

export function envOverride() {
  const value = process.env.MARGINS_TELEMETRY;
  if (!value) return null;
  if (value.toLowerCase() === "off" || value === "0") return false;
  if (value.toLowerCase() === "on" || value === "1") return true;
  return null;
}

export function selfTagEnabled() {
  const value = process.env.MARGINS_TELEMETRY_SELF;
  if (!value) return false;
  return value === "1" || value.toLowerCase() === "on" || value.toLowerCase() === "true";
}

export function applySelfTag(eventPath) {
  if (!selfTagEnabled()) return eventPath;
  return `/dev${eventPath.startsWith("/") ? "" : "/"}${eventPath}`;
}

export function createTelemetry({ consent, fetch = globalThis.fetch } = {}) {
  const envFlag = envOverride();
  const enabled =
    envFlag === false
      ? false
      : envFlag === true
        ? true
        : Boolean(consent && consent.enabled);
  const endpoint = (consent && consent.endpoint) || DEFAULT_ENDPOINT;

  async function postEvent(eventPath) {
    if (!enabled) return { sent: false, reason: "disabled" };
    try {
      const tagged = applySelfTag(eventPath);
      const url = `${endpoint.replace(/\/$/, "")}/count?p=${encodeURIComponent(tagged)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        await fetch(url, { method: "GET", signal: controller.signal });
        return { sent: true, url };
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return { sent: false, reason: "network" };
    }
  }

  function fireAndForget(eventPath) {
    if (!enabled) return;
    postEvent(eventPath).catch(() => {});
  }

  return { enabled, endpoint, postEvent, fireAndForget };
}

export async function loadTelemetry({ fetch } = {}) {
  const consent = await readConsent();
  return createTelemetry({ consent, fetch });
}
