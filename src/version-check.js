// Background version check. Runs at margins_start. Hits the npm registry
// once per 24h, caches the result in <vault>/.margins/version-check.json, and
// returns an updateAvailable hint when the installed version is behind.
//
// Critical: this must NEVER block startup. Network failures, timeouts, bad
// JSON, missing files — all degrade silently to "no update info." A user
// without internet should not see an error from margins_start.
//
// Works for both distribution channels:
//   - npm install: hint suggests `margins-mcp install --update`
//   - .mcpb double-click: hint suggests re-downloading from margins.app

import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REGISTRY_URL = "https://registry.npmjs.org/margins-mcp/latest";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const FETCH_TIMEOUT_MS = 1500;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cachedInstalledVersion = null;

export async function readInstalledVersion() {
  if (cachedInstalledVersion) return cachedInstalledVersion;
  try {
    const pkgPath = path.resolve(__dirname, "../package.json");
    const body = await readFile(pkgPath, "utf8");
    const pkg = JSON.parse(body);
    cachedInstalledVersion = pkg.version || "0.0.0";
  } catch {
    cachedInstalledVersion = "0.0.0";
  }
  return cachedInstalledVersion;
}

export async function checkForUpdate(vault, options = {}) {
  const installVia = options.installVia ?? detectInstallChannel();
  const installed = options.installedVersion ?? (await readInstalledVersion());
  const cachePath = vault.resolveInside(".margins/version-check.json");

  let cached = null;
  try {
    const body = await readFile(cachePath, "utf8");
    cached = JSON.parse(body);
  } catch {
    cached = null;
  }

  const now = Date.now();
  const fresh = cached && cached.checkedAtMs && now - cached.checkedAtMs < CACHE_TTL_MS;

  let latest = cached?.latest ?? null;
  if (!fresh) {
    const fetched = await fetchLatestVersion(options.fetch ?? globalThis.fetch);
    if (fetched) {
      latest = fetched;
      try {
        await mkdir(path.dirname(cachePath), { recursive: true });
        await writeFile(
          cachePath,
          JSON.stringify({ latest, checkedAtMs: now }, null, 2) + "\n",
          "utf8"
        );
      } catch {
        // best-effort cache; never block on disk write
      }
    }
  }

  if (!latest) return null;
  if (!isNewer(latest, installed)) return null;

  return {
    current: installed,
    latest,
    hint: hintFor(installVia)
  };
}

async function fetchLatestVersion(fetchFn) {
  if (typeof fetchFn !== "function") return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetchFn(REGISTRY_URL, {
        method: "GET",
        signal: controller.signal,
        headers: { Accept: "application/json" }
      });
      if (!res.ok) return null;
      const body = await res.json();
      return typeof body?.version === "string" ? body.version : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

export function isNewer(latest, current) {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function parseSemver(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

// Channel detection: if our bin lives inside a Claude Desktop extensions
// directory or a temp .mcpb extraction path, the user installed via
// double-click. Otherwise assume npm.
export function detectInstallChannel(serverBin) {
  const probePath = serverBin ?? path.resolve(__dirname, "..");
  if (/Application Support\/Claude\/extensions/i.test(probePath)) return "mcpb";
  if (/\.mcpb(\/|$)/i.test(probePath)) return "mcpb";
  return "npm";
}

function hintFor(installVia) {
  if (installVia === "mcpb") {
    return "Download the latest .mcpb from https://margins.app and double-click to update.";
  }
  return "Run `margins-mcp install --update` to upgrade to the latest version.";
}
