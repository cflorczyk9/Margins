import { stat } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_SKIP_DIRS = new Set([
  ".git",
  ".obsidian",
  ".trash",
  "node_modules",
  ".claude",
  ".playwright-mcp",
  ".margins",
  "proposed",
  // Agent definition trees: prompt files for other AI systems that have no
  // place in a notes index. Without these, an Obsidian-root index will happily
  // search and surface skill prompts as if they were the user's own writing.
  "agents",
  ".agents"
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
    // If raw/ also exists, index it alongside wiki/. Without this, the
    // README's "drop a file in raw/ and compile it" loop is broken by
    // default for any vault that uses wiki/ + raw/ but has no .obsidian/.
    const hasRaw = await pathExists(path.join(vaultRoot, "raw"));
    const roots = hasRaw ? ["wiki", "raw"] : ["wiki"];
    return { roots, skipDirs: DEFAULT_SKIP_DIRS, source: "margins" };
  }

  return { roots: ["."], skipDirs: DEFAULT_SKIP_DIRS, source: "default" };
}
