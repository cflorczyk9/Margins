// Pile-mode primer helper — stratified file sampling.
//
// The earlier version of this module also extracted "top capitalized phrases"
// across the sample, but a /codex challenge falsified that as overcooked
// pre-processing: Claude reads the snippets directly and identifies entities
// semantically, so a regex-derived phrase list adds noise more than signal.
// Entity extraction now lives in pile-scan.js where it's used to SCORE files
// for compile priority — that's a different job and it's load-bearing there.
//
// Filename pattern detection here is intentionally narrow: only universal
// structural patterns (dated daily, unnamed dumps, free-form). Workflow-
// specific prefixes (meeting-, source-, journal-) are detected per-vault by
// pile-scan.detectPrefixes so they reflect each user's conventions, not ours.

import { readFile, stat } from "node:fs/promises";

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n+/;

export async function samplePileBySnippets(vault, options = {}) {
  const count = options.count ?? 18;
  const snippetChars = options.snippetChars ?? 300;
  const files = await vault.listFiles();
  if (!files.length) {
    return { totalFiles: 0, sample: [], earliestMtime: null, latestMtime: null };
  }

  const withStats = await Promise.all(
    files.map(async (abs) => {
      try {
        const info = await stat(abs);
        return { abs, mtimeMs: info.mtimeMs, size: info.size };
      } catch {
        return null;
      }
    })
  );
  const live = withStats.filter(Boolean).sort((a, b) => a.mtimeMs - b.mtimeMs);
  if (!live.length) {
    return { totalFiles: 0, sample: [], earliestMtime: null, latestMtime: null };
  }

  const picked = pickEvenly(live, count);
  const sample = await Promise.all(
    picked.map(async ({ abs, mtimeMs, size }) => {
      let body;
      try { body = await readFile(abs, "utf8"); } catch { body = ""; }
      const stripped = stripFrontmatter(body);
      const snippet = stripped.slice(0, snippetChars).trim();
      return { path: vault.toRel(abs), mtimeMs, size, snippet };
    })
  );

  return {
    totalFiles: live.length,
    earliestMtime: live[0].mtimeMs,
    latestMtime: live[live.length - 1].mtimeMs,
    sample
  };
}

const PATTERN_DEFS = [
  { pattern: "dated daily (YYYY-MM-DD)", test: (n) => /\d{4}-\d{2}-\d{2}/.test(n) },
  { pattern: "month-dated (YYYY-MM)",    test: (n) => /\b\d{4}-\d{2}\b(?!-\d)/.test(n) },
  { pattern: "unnamed dump",             test: (n) => /^(Untitled|Document[ _]\(?\d+\)?|Note[ _]\d+|New[ _]Note|new[ _]file)/i.test(n) },
  { pattern: "numbered",                 test: (n) => /^\d+\s*\.md$/i.test(n) },
  { pattern: "free-form named",          test: () => true }
];

export function detectFilenamePatterns(relPaths) {
  const buckets = PATTERN_DEFS.map((d) => ({ ...d, files: [] }));
  for (const rel of relPaths) {
    const name = rel.split("/").pop() || rel;
    for (const bucket of buckets) {
      if (bucket.test(name)) {
        bucket.files.push(rel);
        break;
      }
    }
  }
  return buckets
    .filter((b) => b.files.length > 0)
    .map((b) => ({
      pattern: b.pattern,
      count: b.files.length,
      examples: b.files.slice(0, 3)
    }))
    .sort((a, b) => b.count - a.count);
}

function pickEvenly(arr, n) {
  if (arr.length <= n) return [...arr];
  const step = arr.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

function stripFrontmatter(body) {
  return body.replace(FRONTMATTER_RE, "");
}
