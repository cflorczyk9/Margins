import { readFile, readdir } from "node:fs/promises";
import { isSupportedDocumentPath } from "./document-text.js";

const RAW_FILE_RE = /^raw_file:\s*"?raw\/([^"\n]+?)"?\s*$/m;
const RAW_FILES_BLOCK_RE = /^raw_files:\s*\n((?:[ \t]*-\s+.+(?:\n|$))+)/m;
const RAW_FILES_ITEM_RE = /^\s*-\s+"?raw\/([^"\n]+?)"?\s*$/gm;

export async function buildRawIndex(vault) {
  const rawFiles = await listRawFiles(vault);
  const referenced = new Map();
  if (!rawFiles.length) return { rawFiles, referenced, pending: [] };

  const rawSet = new Set(rawFiles);
  const files = await vault.listFiles();
  for (const abs of files) {
    const rel = vault.toRel(abs);
    if (!rel.endsWith(".md") || rel.startsWith("raw/")) continue;
    let body;
    try {
      body = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    if (!body.startsWith("---\n")) continue;
    const fmEnd = body.indexOf("\n---", 4);
    if (fmEnd < 0) continue;
    const fm = body.slice(4, fmEnd + 1);

    const single = fm.match(RAW_FILE_RE);
    if (single) {
      const name = single[1].trim();
      if (rawSet.has(name) && !referenced.has(name)) referenced.set(name, rel);
    }

    const list = fm.match(RAW_FILES_BLOCK_RE);
    if (list) {
      for (const item of list[1].matchAll(RAW_FILES_ITEM_RE)) {
        const name = item[1].trim();
        if (rawSet.has(name) && !referenced.has(name)) referenced.set(name, rel);
      }
    }
  }

  const pending = rawFiles.filter((n) => !referenced.has(n));
  return { rawFiles, referenced, pending };
}

async function listRawFiles(vault) {
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
