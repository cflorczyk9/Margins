import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  extractDocumentText,
  isSupportedDocumentPath,
  isTextDocumentPath
} from "./document-text.js";
import { DEFAULT_SKIP_DIRS } from "./index-roots.js";

const READ_PAGE_MAX_CHARS = 250 * 1024;  // 250KB extracted-text cap per read_page call

export function createVault(rootArg, options = {}) {
  const root = path.resolve(rootArg);
  const indexRoots = options.indexRoots && options.indexRoots.length
    ? options.indexRoots
    : ["."];
  const skipDirs = options.skipDirs || DEFAULT_SKIP_DIRS;

  function resolveInside(rel) {
    const normalized = path
      .normalize(String(rel ?? ""))
      .replace(/^[/\\]+/, "");
    const abs = path.resolve(root, normalized);
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    if (abs !== root && !abs.startsWith(rootWithSep)) {
      throw new Error(`Path escapes vault root: ${rel}`);
    }
    return abs;
  }

  function toRel(abs) {
    return path.relative(root, abs).split(path.sep).join("/");
  }

  async function walk(dir, out) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        await walk(abs, out);
      } else if (entry.isFile()) {
        if (!isSupportedDocumentPath(entry.name)) continue;
        out.push(abs);
      }
    }
  }

  async function listFiles() {
    const out = [];
    const seen = new Set();
    for (const rel of indexRoots) {
      const abs = rel === "." || rel === "" ? root : resolveInside(rel);
      const sub = [];
      await walk(abs, sub);
      for (const f of sub) {
        if (!seen.has(f)) {
          seen.add(f);
          out.push(f);
        }
      }
    }
    return out;
  }

  async function readPage(relPath) {
    const abs = resolveInside(relPath);
    const rel = toRel(abs);
    const fullBody = await extractDocumentText(abs, rel, { allowEmpty: isTextDocumentPath(abs) });
    const info = await stat(abs);
    // Cap extracted text at READ_PAGE_MAX_CHARS so a 22MB PDF doesn't return
    // 465KB+ of text through the MCP transport. Some MCP clients choke on
    // very large tool responses, and most readers don't need the whole thing
    // — they want a chunk and the option to query for more.
    const truncated = fullBody.length > READ_PAGE_MAX_CHARS;
    const body = truncated
      ? fullBody.slice(0, READ_PAGE_MAX_CHARS) +
        `\n\n[Truncated at ${READ_PAGE_MAX_CHARS} characters; full extracted text is ${fullBody.length} characters. ` +
        `Use search_vault to query specific terms in this file, or inspect the original file outside MCP for the full text.]`
      : fullBody;
    return {
      path: rel,
      body,
      mtimeMs: info.mtimeMs,
      size: info.size,
      textLength: fullBody.length,
      truncated
    };
  }

  async function listRecent(limit) {
    const files = await listFiles();
    const withStats = await Promise.all(
      files.map(async (abs) => {
        const info = await stat(abs);
        return { abs, mtimeMs: info.mtimeMs };
      })
    );
    withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return withStats.slice(0, limit).map(({ abs, mtimeMs }) => ({
      path: toRel(abs),
      mtimeMs
    }));
  }

  async function searchVault(query, limit) {
    const needle = String(query ?? "").trim().toLowerCase();
    if (!needle) return [];
    const filenameLike = looksLikeFilenameQuery(needle);
    const files = await listFiles();
    const hits = [];
    for (const abs of files) {
      const rel = toRel(abs);
      const baseHit = rel.toLowerCase().includes(needle);
      let body = "";
      let idx = -1;
      let extractionError = null;
      const textDoc = isTextDocumentPath(abs);
      const shouldExtract = textDoc || (!baseHit && !filenameLike);
      if (shouldExtract) {
        try {
          body = await extractDocumentText(abs, rel, { allowEmpty: textDoc });
          idx = body.toLowerCase().indexOf(needle);
        } catch (err) {
          extractionError = err;
        }
      }
      if (!baseHit && idx < 0) continue;
      const snippet = idx >= 0
        ? extractSnippet(body, idx, needle.length)
        : extractionError
          ? `Filename match; text extraction failed: ${extractionError.message}`
          : baseHit
            ? "Filename match."
            : firstNonEmptyLine(body);
      hits.push({
        path: rel,
        score: baseHit ? 2 : 1,
        snippet
      });
      if (hits.length >= limit * 4) break;
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  async function getBacklinks(target, limit) {
    const slug = String(target ?? "").trim();
    if (!slug) return [];
    const base = slug.replace(/\.md$/i, "");
    const needles = [
      `[[${base}]]`,
      `[[${base}|`,
      `(${base}.md)`,
      `/${base}.md`
    ].map((n) => n.toLowerCase());
    const files = await listFiles();
    const hits = [];
    for (const abs of files) {
      if (!isTextDocumentPath(abs)) continue;
      let body;
      try {
        body = await readFile(abs, "utf8");
      } catch {
        continue;
      }
      const lower = body.toLowerCase();
      const rel = toRel(abs);
      const matchIdx = needles
        .map((n) => lower.indexOf(n))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b)[0];
      if (matchIdx === undefined) continue;
      hits.push({ path: rel, snippet: extractSnippet(body, matchIdx, 0) });
      if (hits.length >= limit) break;
    }
    return hits;
  }

  return {
    root,
    resolveInside,
    toRel,
    listFiles,
    readPage,
    listRecent,
    searchVault,
    getBacklinks
  };
}

function looksLikeFilenameQuery(needle) {
  return needle.includes("/") || /\.[a-z0-9]{2,8}$/i.test(needle);
}

function extractSnippet(body, idx, matchLen) {
  const start = Math.max(0, idx - 80);
  const end = Math.min(body.length, idx + matchLen + 120);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < body.length ? "…" : "";
  return prefix + body.slice(start, end).replace(/\s+/g, " ").trim() + suffix;
}

function firstNonEmptyLine(body) {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.slice(0, 200);
  }
  return "";
}
