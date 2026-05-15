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

const CONSENT_CACHE_TTL_MS = 5000;

export function createTelemetry({ consent, fetch = globalThis.fetch } = {}) {
  // Initial snapshot — used for the startup log message. The runtime
  // enabled-check below re-reads consent so that in-chat opt-in via
  // record_telemetry_consent takes effect on the currently running server
  // without a restart.
  const initialEnvFlag = envOverride();
  const enabled =
    initialEnvFlag === false
      ? false
      : initialEnvFlag === true
        ? true
        : Boolean(consent && consent.enabled);
  const initialEndpoint = (consent && consent.endpoint) || DEFAULT_ENDPOINT;

  // Short-TTL cache to avoid disk reads on every tool call.
  let cachedConsent = consent || null;
  let cachedAt = consent ? Date.now() : 0;

  async function currentConsent() {
    const now = Date.now();
    if (cachedConsent !== null && now - cachedAt < CONSENT_CACHE_TTL_MS) {
      return cachedConsent;
    }
    cachedConsent = await readConsent();
    cachedAt = now;
    return cachedConsent;
  }

  async function isEnabledNow() {
    const envFlag = envOverride();
    if (envFlag === false) return false;
    if (envFlag === true) return true;
    const c = await currentConsent();
    return Boolean(c && c.enabled);
  }

  async function currentEndpoint() {
    const c = await currentConsent();
    return (c && c.endpoint) || DEFAULT_ENDPOINT;
  }

  async function postEvent(eventPath) {
    // Capture env-dependent state synchronously before any await so that
    // tests using a try/finally env restore (which yields between sync
    // micro-tasks) still see the intended env.
    const tagged = applySelfTag(eventPath);
    if (!(await isEnabledNow())) return { sent: false, reason: "disabled" };
    const endpoint = await currentEndpoint();
    try {
      const url = `${endpoint.replace(/\/$/, "")}/count?p=${encodeURIComponent(tagged)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        await fetch(url, {
          method: "GET",
          signal: controller.signal,
          headers: { "User-Agent": "margins-mcp" }
        });
        return { sent: true, url };
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return { sent: false, reason: "network" };
    }
  }

  function fireAndForget(eventPath) {
    isEnabledNow()
      .then((on) => {
        if (!on) return;
        postEvent(eventPath).catch(() => {});
      })
      .catch(() => {});
  }

  // forceFire bypasses the user's consent gate but still respects the master
  // env override (MARGINS_TELEMETRY=off). Used for install-completion which
  // is a one-shot funnel signal — counts that an install happened, with no
  // usage data attached. Per-tool events stay gated by consent.
  async function postEventForced(eventPath) {
    const envFlag = envOverride();
    if (envFlag === false) return { sent: false, reason: "env-off" };
    const tagged = applySelfTag(eventPath);
    const endpoint = await currentEndpoint();
    try {
      const url = `${endpoint.replace(/\/$/, "")}/count?p=${encodeURIComponent(tagged)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        await fetch(url, {
          method: "GET",
          signal: controller.signal,
          headers: { "User-Agent": "margins-mcp" }
        });
        return { sent: true, url };
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return { sent: false, reason: "network" };
    }
  }

  function forceFire(eventPath) {
    postEventForced(eventPath).catch(() => {});
  }

  function invalidateConsentCache() {
    cachedConsent = null;
    cachedAt = 0;
  }

  return {
    enabled,
    endpoint: initialEndpoint,
    postEvent,
    postEventForced,
    fireAndForget,
    forceFire,
    invalidateConsentCache
  };
}

export async function loadTelemetry({ fetch } = {}) {
  const consent = await readConsent();
  return createTelemetry({ consent, fetch });
}
