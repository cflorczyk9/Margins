import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isSupportedDocumentPath } from "./document-text.js";

const RAW_FILE_RE = /^raw_file:\s*"?([^"\n]+?)"?\s*$/m;
const RAW_FILES_BLOCK_RE = /^raw_files:\s*\n((?:[ \t]*-\s+.+(?:\n|$))+)/m;
const RAW_FILES_ITEM_RE = /^\s*-\s+"?([^"\n]+?)"?\s*$/gm;
const TYPE_RE = /^type:\s*"?([^"\n]+?)"?\s*$/m;

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
  "node_modules"
]);

export async function buildVaultIndex(vault, options = {}) {
  const ingestRoots = await resolveIngestRoots(vault, options);
  const allFiles = await vault.listFiles();

  const candidates = [];
  const sourcePages = [];

  for (const abs of allFiles) {
    const rel = vault.toRel(abs);
    if (META_PATHS.has(rel)) continue;
    if (!isSupportedDocumentPath(rel)) continue;

    const fm = await readFrontmatter(abs);
    const fmType = fm?.match(TYPE_RE)?.[1]?.trim();

    if (fmType === "source" || fmType === "synthesis") {
      sourcePages.push({ abs, rel, fm });
      continue;
    }

    if (fmType) continue;

    if (!isInIngestRoot(rel, ingestRoots)) continue;
    if (isInSkipDir(rel)) continue;

    candidates.push(rel);
  }

  // proposed/ is excluded from vault.listFiles() by DEFAULT_SKIP_DIRS, but
  // staged source-page proposals must count as "tentatively referenced" so
  // duplicate compiles of the same raw file return already-filed.
  await collectProposedSourcePages(vault, sourcePages);

  const referenced = new Map();
  for (const page of sourcePages) {
    const single = page.fm.match(RAW_FILE_RE);
    if (single) {
      const target = normalizeRef(single[1].trim());
      if (target && !referenced.has(target)) referenced.set(target, page.rel);
    }
    const list = page.fm.match(RAW_FILES_BLOCK_RE);
    if (list) {
      for (const item of list[1].matchAll(RAW_FILES_ITEM_RE)) {
        const target = normalizeRef(item[1].trim());
        if (target && !referenced.has(target)) referenced.set(target, page.rel);
      }
    }
  }

  const pending = candidates.filter((c) => !referenced.has(c));
  return {
    candidates,
    referenced,
    pending,
    sourcePagesCount: sourcePages.length,
    ingestRoots
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

function normalizeRef(value) {
  if (!value) return null;
  return value.replace(/^\.\//, "");
}

async function readFrontmatter(abs) {
  let body;
  try {
    body = await readFile(abs, "utf8");
  } catch {
    return null;
  }
  if (!body.startsWith("---\n")) return null;
  const end = body.indexOf("\n---", 4);
  if (end < 0) return null;
  return body.slice(4, end + 1);
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
    const fm = await readFrontmatter(abs);
    const fmType = fm?.match(TYPE_RE)?.[1]?.trim();
    if (fmType !== "source" && fmType !== "synthesis") continue;
    out.push({ abs, rel: vault.toRel(abs), fm });
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
    .filter((n) => !n.startsWith(".") && n !== "README.md")
    .filter((n) => isSupportedDocumentPath(n));
}
