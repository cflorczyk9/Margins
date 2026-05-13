import { stat } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_SKIP_DIRS = new Set([
  ".git",
  ".obsidian",
  ".trash",
  "node_modules",
  ".claude",
  ".margins",
  "proposed"
]);

async function pathExists(abs) {
  try {
    const info = await stat(abs);
    return info.isDirectory();
  } catch {
    return false;
  }
}

export async function detectIndexRoots(vaultRoot, envValue) {
  if (envValue && envValue.trim()) {
    const roots = envValue
      .split(",")
      .map((s) => s.trim().replace(/^\.?\/+/, "").replace(/\/+$/, ""))
      .filter((s) => s && s !== ".");
    if (roots.length) {
      return { roots, skipDirs: DEFAULT_SKIP_DIRS, source: "env" };
    }
    return { roots: ["."], skipDirs: DEFAULT_SKIP_DIRS, source: "env-empty" };
  }

  const hasObsidian = await pathExists(path.join(vaultRoot, ".obsidian"));
  if (hasObsidian) {
    return { roots: ["."], skipDirs: DEFAULT_SKIP_DIRS, source: "obsidian" };
  }

  const hasWiki = await pathExists(path.join(vaultRoot, "wiki"));
  if (hasWiki) {
    return { roots: ["wiki"], skipDirs: DEFAULT_SKIP_DIRS, source: "margins" };
  }

  return { roots: ["."], skipDirs: DEFAULT_SKIP_DIRS, source: "default" };
}
