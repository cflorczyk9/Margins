import { readFile, readdir } from "node:fs/promises";
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

export async function buildVaultIndex(vault) {
  const allFiles = await vault.listFiles();

  const candidates = [];
  const sourcePages = [];

  for (const abs of allFiles) {
    const rel = vault.toRel(abs);
    if (META_PATHS.has(rel)) continue;
    if (!isSupportedDocumentPath(rel)) continue;

    const fm = await readFrontmatter(abs);
    const fmType = fm?.match(TYPE_RE)?.[1]?.trim();

    if (fmType) {
      if (fmType === "source" || fmType === "synthesis") sourcePages.push({ abs, rel, fm });
      continue;
    }

    candidates.push(rel);
  }

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
  return { candidates, referenced, pending, sourcePagesCount: sourcePages.length };
}

export const buildRawIndex = buildVaultIndex;

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
