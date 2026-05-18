import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isSupportedDocumentPath } from "./document-text.js";
import { parseFrontmatter, extractRawFileRefs, getType } from "./frontmatter.js";
import { canonicalize } from "./paths.js";

const META_PATHS = new Set([
  "wiki/ingest-tracker.md",
  "wiki/wiki-stats.md",
  "wiki/log.md",
  "wiki/index.md"
]);

const SKIP_PATH_SEGMENTS = new Set([
  "wiki",
  "proposed",
  ".margins",
  ".obsidian",
  ".git",
  "node_modules",
  ".playwright-mcp"
]);

export async function buildVaultIndex(vault, options = {}) {
  const ingestRoots = await resolveIngestRoots(vault, options);
  const allFiles = await vault.listFiles();

  const candidates = [];
  const sourcePages = [];
  const parseFailures = [];

  for (const abs of allFiles) {
    const rel = canonicalize(vault.toRel(abs));
    if (META_PATHS.has(rel)) continue;
    if (!isSupportedDocumentPath(rel)) continue;

    let body;
    try {
      body = await readFile(abs, "utf8");
    } catch {
      continue;
    }

    let parsed;
    try {
      parsed = parseFrontmatter(body);
    } catch (err) {
      // Parse failure on a file that has frontmatter markers — surface to
      // the doctor so the user knows their YAML is broken. We don't try to
      // treat it as a candidate because the file clearly intended to be a
      // structured page.
      parseFailures.push({ path: rel, error: err.message });
      continue;
    }

    const fmType = parsed ? getType(parsed.data) : null;

    if (fmType === "source" || fmType === "synthesis") {
      sourcePages.push({ abs, rel, data: parsed.data });
      continue;
    }

    if (fmType) continue;

    if (!isInIngestRoot(rel, ingestRoots)) continue;
    if (isInSkipDir(rel)) continue;
    if (SKIP_CANDIDATE_BASENAMES.has(rel.split("/").pop())) continue;

    candidates.push(rel);
  }

  // proposed/ is excluded from vault.listFiles() by DEFAULT_SKIP_DIRS, but
  // staged source-page proposals must count as "tentatively referenced" so
  // duplicate compiles of the same raw file return already-filed.
  await collectProposedSourcePages(vault, sourcePages);

  const referenced = new Map();
  for (const page of sourcePages) {
    const refs = extractRawFileRefs(page.data);
    for (const ref of refs) {
      const target = canonicalize(ref);
      if (target && !referenced.has(target)) referenced.set(target, page.rel);
    }
  }

  const pending = candidates.filter((c) => !referenced.has(c));
  return {
    candidates,
    referenced,
    pending,
    sourcePagesCount: sourcePages.length,
    ingestRoots,
    parseFailures
  };
}

export const buildRawIndex = buildVaultIndex;

async function resolveIngestRoots(vault, options) {
  if (Array.isArray(options.ingestRoots) && options.ingestRoots.length) {
    return normalizeRoots(options.ingestRoots);
  }
  const env = process.env.MARGINS_INGEST_ROOTS;
  if (env && env.trim()) {
    return normalizeRoots(env.split(","));
  }
  try {
    const info = await stat(vault.resolveInside("raw"));
    if (info.isDirectory()) return ["raw"];
  } catch {
    // raw/ missing — fall through
  }
  return ["."];
}

function normalizeRoots(roots) {
  return roots
    .map((r) => String(r).trim().replace(/^\.\//, "").replace(/\/$/, ""))
    .filter((r) => r.length > 0 || r === ".")
    .map((r) => (r === "" ? "." : r));
}

function isInIngestRoot(rel, roots) {
  for (const root of roots) {
    if (root === "." || root === "") return true;
    if (rel === root) return true;
    if (rel.startsWith(root + "/")) return true;
  }
  return false;
}

function isInSkipDir(rel) {
  const parts = rel.split("/");
  for (const part of parts.slice(0, -1)) {
    if (SKIP_PATH_SEGMENTS.has(part)) return true;
  }
  return false;
}

// Parsed-frontmatter cache for proposed/ source pages. Keyed by absolute path
// with the file's mtimeMs stored alongside the parsed entry. Without this,
// every buildVaultIndex call re-reads + re-parses every staged source page
// in proposed/. Under bulk compile (50+ segments), the index is rebuilt per
// compile, so the same N proposed pages are parsed O(N^2) times. The cache
// turns that into O(N) reads on the first walk plus stat-only walks after.
//
// Invalidation: stat returns a different mtimeMs (or the file is gone) → re-
// parse. Stale entries for files that no longer exist accumulate until the
// process exits, but the working set is naturally bounded by the proposal
// queue (rarely > a few hundred entries).
const _proposedFmCache = new Map();

export function _resetProposedFmCacheForTests() {
  _proposedFmCache.clear();
}

async function collectProposedSourcePages(vault, out) {
  const proposedRoot = vault.resolveInside("proposed");
  await walkForSourcePages(vault, proposedRoot, out);
}

async function walkForSourcePages(vault, dir, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkForSourcePages(vault, abs, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!isSupportedDocumentPath(entry.name)) continue;

    let info;
    try {
      info = await stat(abs);
    } catch {
      _proposedFmCache.delete(abs);
      continue;
    }

    const cached = _proposedFmCache.get(abs);
    if (cached && cached.mtimeMs === info.mtimeMs) {
      if (cached.entry) out.push(cached.entry);
      continue;
    }

    let body;
    try {
      body = await readFile(abs, "utf8");
    } catch {
      _proposedFmCache.delete(abs);
      continue;
    }
    const parsed = parseFrontmatter(body);
    if (!parsed) {
      _proposedFmCache.set(abs, { mtimeMs: info.mtimeMs, entry: null });
      continue;
    }
    const fmType = getType(parsed.data);
    if (fmType !== "source" && fmType !== "synthesis") {
      _proposedFmCache.set(abs, { mtimeMs: info.mtimeMs, entry: null });
      continue;
    }
    const entryRecord = { abs, rel: canonicalize(vault.toRel(abs)), data: parsed.data };
    _proposedFmCache.set(abs, { mtimeMs: info.mtimeMs, entry: entryRecord });
    out.push(entryRecord);
  }
}

export async function listRawFolderFiles(vault) {
  let entries;
  try {
    entries = await readdir(vault.resolveInside("raw"), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((n) => !SKIP_CANDIDATE_BASENAMES.has(n) && !n.startsWith("."))
    .filter((n) => isSupportedDocumentPath(n));
}

const SKIP_CANDIDATE_BASENAMES = new Set(["README.md", "readme.md", "LICENSE", "LICENSE.md"]);
