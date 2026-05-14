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
  "node_modules"
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
    } catch {
      parseFailures.push(rel);
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
    let body;
    try {
      body = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    const parsed = parseFrontmatter(body);
    if (!parsed) continue;
    const fmType = getType(parsed.data);
    if (fmType !== "source" && fmType !== "synthesis") continue;
    out.push({ abs, rel: canonicalize(vault.toRel(abs)), data: parsed.data });
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
