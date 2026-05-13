import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Obsidian stores known-vault registry at platform-specific locations. We read
// that file, filter out vaults whose paths no longer exist on disk (Obsidian
// leaves stale entries), and sort by most-recently-used so the installer can
// pick a sensible default without asking.

export function obsidianRegistryPath() {
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(home, "Library/Application Support/obsidian/obsidian.json");
    case "linux":
      return path.join(home, ".config/obsidian/obsidian.json");
    case "win32":
      return path.join(
        process.env.APPDATA || path.join(home, "AppData/Roaming"),
        "obsidian/obsidian.json"
      );
    default:
      return null;
  }
}

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function detectObsidianVaults() {
  const registryPath = obsidianRegistryPath();
  if (!registryPath) return { registryPath: null, vaults: [], registryFound: false };

  let raw;
  try {
    raw = await readFile(registryPath, "utf8");
  } catch {
    return { registryPath, vaults: [], registryFound: false };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { registryPath, vaults: [], registryFound: true, parseError: true };
  }

  const entries = parsed.vaults && typeof parsed.vaults === "object"
    ? Object.entries(parsed.vaults)
    : [];

  const candidates = [];
  for (const [id, info] of entries) {
    if (!info || typeof info.path !== "string") continue;
    candidates.push({
      id,
      path: info.path,
      ts: typeof info.ts === "number" ? info.ts : 0,
      isOpen: Boolean(info.open),
      name: path.basename(info.path)
    });
  }

  // Filter out vaults whose paths no longer exist on disk.
  const live = [];
  for (const c of candidates) {
    if (await pathExists(c.path)) live.push(c);
  }

  // Most recently used first; open vault wins ties.
  live.sort((a, b) => {
    if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
    return b.ts - a.ts;
  });

  return { registryPath, vaults: live, registryFound: true };
}
