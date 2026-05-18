import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  extractDocumentText,
  isSupportedDocumentPath,
  isTextDocumentPath
} from "./document-text.js";
import { DEFAULT_SKIP_DIRS } from "./index-roots.js";
import { pathPriority } from "./paths.js";

const READ_PAGE_MAX_CHARS = 250 * 1024;  // 250KB extracted-text cap per read_page call

// Multi-word search scoring weights. Hoisted so the ranking policy is readable
// in one place. Must stay an order of magnitude apart so each higher signal
// dominates lower ones — tokensMatched always beats phraseMatch, etc.
const SCORE_TOKEN_WEIGHT = 10_000;
const SCORE_PHRASE_WEIGHT = 1_000;
const SCORE_COLOCATE_WEIGHT = 500;
const SCORE_FILENAME_WEIGHT = 50;
const SCORE_FREQUENCY_CAP = 200;
const COLOCATE_WINDOW_CHARS = 100;

// Cap query tokens so an LLM-supplied pathological query (200+ tokens) can't
// turn search_vault into O(files * tokens) full-body scans. 12 covers any
// natural-language query a user would actually type.
const MAX_QUERY_TOKENS = 12;

// Stopwords for multi-word natural-language search. Conservative — only
// syntactic stopwords plus a few clearly-meta verbs that a user types into a
// search box but doesn't actually want to match ("show", "find"). Content
// words a user might legitimately search for ("notes", "page", "write",
// "mention") deliberately stay OUT of this set.
const QUERY_STOPWORDS = new Set([
  // articles + conjunctions
  "a", "an", "the", "and", "or", "but", "nor",
  // prepositions
  "of", "in", "on", "at", "to", "for", "with", "from", "by", "as",
  "into", "onto", "over", "under", "about", "between", "through", "across",
  // auxiliaries + question helpers
  "is", "are", "was", "were", "be", "been", "being", "am",
  "do", "does", "did", "doing", "done",
  "have", "has", "had", "having",
  "can", "could", "would", "should", "shall", "may", "might", "must", "will",
  // pronouns + possessives
  "i", "me", "my", "mine", "you", "your", "yours",
  "he", "him", "his", "she", "her", "hers",
  "it", "its", "we", "us", "our", "ours", "they", "them", "their", "theirs",
  // demonstratives + wh-words
  "this", "that", "these", "those",
  "what", "when", "where", "who", "whom", "why", "which", "how",
  // very-common query-meta verbs
  "show", "find", "tell", "get", "give", "see"
]);

export function tokenizeQuery(query) {
  return String(query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !QUERY_STOPWORDS.has(s));
}

export function createVault(rootArg, options = {}) {
  const root = path.resolve(rootArg);
  // Resolve root through symlinks once so the symlink-escape check below can
  // compare apples to apples. On macOS, /tmp is itself a symlink to
  // /private/tmp — without this, every read from a tmp-test fixture would
  // look like a symlink escape.
  let realRoot = root;
  try {
    // realpathSync via sync FS isn't available here without importing; we
    // resolve lazily in the first symlink check and cache.
  } catch {}
  const indexRoots = options.indexRoots && options.indexRoots.length
    ? options.indexRoots
    : ["."];
  const skipDirs = options.skipDirs || DEFAULT_SKIP_DIRS;

  function resolveInside(rel) {
    const raw = String(rel ?? "");
    if (/^[/\\]/.test(raw)) {
      throw new Error(
        `Paths must be vault-relative; got absolute path '${raw}'. ` +
          `Use a path like 'wiki/career/career.md' (no leading slash).`
      );
    }
    // Normalize backslashes to forward slashes BEFORE path.normalize so that
    // a Windows-style traversal like '..\\..\\etc\\hosts' is recognized as
    // a traversal on every platform, not silently treated as a literal
    // filename on Unix (where it gets written as `..\escape.md` inside the
    // vault — not a breach, but surprising, and a real escape on Windows).
    const slashed = raw.replace(/\\/g, "/");
    const normalized = path.normalize(slashed);
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
      // Skip symlinks entirely — both file and dir variants. A symlink
      // pointing outside the vault would silently expose external files to
      // search and reads. Users with legitimate intra-vault symlinks should
      // copy/hard-link instead.
      if (entry.isSymbolicLink()) continue;
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

  // Symlink-escape defense for any read/write path. resolveInside() catches
  // textual escapes (`..`, leading slash, backslash) but a symlink inside the
  // vault that points OUTSIDE — e.g. wiki/notes/leak.md -> /etc/passwd — would
  // be followed silently by readFile. Resolve to the real path and confirm
  // it still lives under root. ENOENT is fine (file doesn't exist yet); other
  // errors propagate. realRoot is cached on first use so we don't pay a
  // realpath() per read.
  async function getRealRoot() {
    if (realRoot === root) {
      try {
        realRoot = await realpath(root);
      } catch {
        // Root itself isn't real-resolvable; treat the textual root as truth.
        realRoot = root;
      }
    }
    return realRoot;
  }
  async function assertRealPathInside(abs) {
    let real;
    try {
      real = await realpath(abs);
    } catch (err) {
      if (err && err.code === "ENOENT") return;
      throw err;
    }
    const rr = await getRealRoot();
    const rrWithSep = rr.endsWith(path.sep) ? rr : rr + path.sep;
    if (real !== rr && !real.startsWith(rrWithSep)) {
      throw new Error(
        `Path resolves outside vault root via symlink: ${path.relative(root, abs)}`
      );
    }
  }

  async function readPage(relPath) {
    const abs = resolveInside(relPath);
    await assertRealPathInside(abs);
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
    const cleaned = String(query ?? "").trim();
    if (!cleaned) {
      throw new Error(
        "search_vault requires a non-empty query. Pass a term like 'briefly pricing' or a filename fragment."
      );
    }
    const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
    // Single-word queries (e.g. 'Affinity', 'briefly.md') use the existing
    // substring path. Multi-word queries use the natural-language token path.
    if (wordCount <= 1) {
      return substringSearch(cleaned.toLowerCase(), limit);
    }
    const tokens = tokenizeQuery(cleaned);
    if (tokens.length === 0) {
      throw new Error(
        `Query '${cleaned}' has no searchable terms after dropping stopwords. ` +
          `Add a noun like 'briefly' or 'pricing'.`
      );
    }
    if (tokens.length === 1) {
      return substringSearch(tokens[0], limit);
    }
    // Cap tokens to prevent a pathological query (e.g. prompt-injected from a
    // source doc) from forcing O(files * tokens) full-body scans.
    const cappedTokens = tokens.slice(0, MAX_QUERY_TOKENS);
    return tokenSearch(cappedTokens, cleaned.toLowerCase(), limit);
  }

  async function substringSearch(needle, limit) {
    const filenameLike = looksLikeFilenameQuery(needle);
    const files = await listFiles();
    // Compute rel and priority once per file (not twice — toRel and pathPriority
    // both cost something at vault scale).
    const ordered = files
      .map((abs) => {
        const rel = toRel(abs);
        return { abs, rel, priority: pathPriority(rel) };
      })
      .sort((a, b) => b.priority - a.priority);
    const topTier = ordered.length ? ordered[0].priority : 0;
    const hits = [];
    for (const { abs, rel, priority } of ordered) {
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
          ? "Filename match; text extraction failed."
          : baseHit
            ? "Filename match."
            : firstNonEmptyLine(body);
      if (extractionError) {
        // Log details server-side so vault owners can diagnose extraction
        // problems without exposing parser internals (which can carry absolute
        // filesystem paths) into the LLM context.
        console.error(`margins: text extraction failed for ${rel}: ${extractionError.message}`);
      }
      hits.push({
        path: rel,
        score: baseHit ? 2 : 1,
        priority,
        snippet,
        tokensMatched: 1,
        tokensTotal: 1
      });
      // Stop once we have `limit` hits at the top priority tier and the walk
      // has moved past that tier. (The previous check compared against the
      // last-pushed hit's priority, which is always the current priority —
      // a no-op.)
      if (hits.length >= limit && topTier > 0 && priority < topTier) break;
      if (hits.length >= limit * 4) break;
    }
    hits.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return b.score - a.score;
    });
    return hits.slice(0, limit).map(({ priority, ...rest }) => rest);
  }

  async function tokenSearch(tokens, phrase, limit) {
    const files = await listFiles();
    const ordered = files
      .map((abs) => {
        const rel = toRel(abs);
        return { abs, rel, priority: pathPriority(rel) };
      })
      .sort((a, b) => b.priority - a.priority);
    const hits = [];
    const tokensTotal = tokens.length;
    const topTier = ordered.length ? ordered[0].priority : 0;
    // Counter for the early-stop check. Was a `hits.filter(...)` inside the
    // hot loop — O(hits) per file, quadratic worst-case across the walk.
    let fullMatchesAtTopTier = 0;

    for (const { abs, rel, priority } of ordered) {
      const lowerRel = rel.toLowerCase();
      const tokensInFilename = tokens.reduce(
        (n, t) => n + (lowerRel.includes(t) ? 1 : 0),
        0
      );
      // Skip body extraction if every token is already in the filename — saves
      // work on PDF/DOCX whose name spells out the topic.
      const allTokensInFilename = tokensInFilename === tokensTotal;
      const textDoc = isTextDocumentPath(abs);
      const shouldExtract = textDoc || !allTokensInFilename;

      let body = "";
      let extractionError = null;
      if (shouldExtract) {
        try {
          body = await extractDocumentText(abs, rel, { allowEmpty: textDoc });
        } catch (err) {
          extractionError = err;
        }
      }
      const lowerBody = body.toLowerCase();
      const tokenFirstPos = tokens.map((t) => (body ? lowerBody.indexOf(t) : -1));
      const tokensInBody = tokenFirstPos.reduce(
        (n, p) => n + (p >= 0 ? 1 : 0),
        0
      );
      const tokensMatched = tokens.reduce(
        (n, t, i) =>
          n + (tokenFirstPos[i] >= 0 || lowerRel.includes(t) ? 1 : 0),
        0
      );
      if (tokensMatched === 0) continue;

      const phraseMatch = body ? lowerBody.includes(phrase) ? 1 : 0 : 0;
      const coLocate = tokensInBody >= 2 ? computeCoLocate(tokenFirstPos) : 0;
      const frequency = body
        ? tokens.reduce((n, t) => n + countTokenOccurrences(lowerBody, t), 0)
        : 0;

      // Single-pass earliest-position lookup; avoids filter + sort allocation.
      let earliestBodyPos = -1;
      for (const p of tokenFirstPos) {
        if (p >= 0 && (earliestBodyPos < 0 || p < earliestBodyPos)) earliestBodyPos = p;
      }
      let snippet;
      if (earliestBodyPos >= 0) {
        snippet = extractSnippet(body, earliestBodyPos, 0);
      } else if (extractionError) {
        snippet = "Filename match; text extraction failed.";
        console.error(`margins: text extraction failed for ${rel}: ${extractionError.message}`);
      } else {
        const matched = tokens.filter((t) => lowerRel.includes(t));
        snippet = `Filename match: ${matched.join(", ")}`;
      }

      hits.push({
        path: rel,
        priority,
        tokensMatched,
        tokensTotal,
        phraseMatch,
        coLocate,
        frequency,
        tokensInFilename,
        snippet,
        score:
          tokensMatched * SCORE_TOKEN_WEIGHT +
          phraseMatch * SCORE_PHRASE_WEIGHT +
          coLocate * SCORE_COLOCATE_WEIGHT +
          tokensInFilename * SCORE_FILENAME_WEIGHT +
          Math.min(frequency, SCORE_FREQUENCY_CAP)
      });

      // Track full matches at the top tier as we go — used by the early-stop
      // check below. Was a per-iteration `hits.filter(...)`, which was O(hits)
      // every loop and grew quadratic over the walk.
      if (priority === topTier && tokensMatched === tokensTotal) {
        fullMatchesAtTopTier++;
      }

      // Stop only after the priority tier has dropped AND we have `limit` full
      // matches at the top tier. Otherwise an alphabetically-earlier hub page
      // can starve a higher-relevance match below it.
      if (priority < topTier && fullMatchesAtTopTier >= limit) break;
    }

    hits.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (b.tokensMatched !== a.tokensMatched) return b.tokensMatched - a.tokensMatched;
      // Files whose filename carries the query tokens (e.g. centric-pilot-
      // agreement.md when searching "Centric pilot agreement") are almost
      // always more on-topic than hub or daily pages that mention the same
      // terms in passing. This is the most important tiebreaker after
      // tokensMatched.
      if (b.tokensInFilename !== a.tokensInFilename) return b.tokensInFilename - a.tokensInFilename;
      if (b.phraseMatch !== a.phraseMatch) return b.phraseMatch - a.phraseMatch;
      if (b.coLocate !== a.coLocate) return b.coLocate - a.coLocate;
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return a.path.localeCompare(b.path);
    });
    return hits.slice(0, limit).map((h) => ({
      path: h.path,
      score: h.score,
      snippet: h.snippet,
      tokensMatched: h.tokensMatched,
      tokensTotal: h.tokensTotal
    }));
  }

  async function getBacklinks(target, limit) {
    const slug = String(target ?? "").trim();
    if (!slug) {
      throw new Error(
        "get_backlinks requires a non-empty target slug (e.g. 'briefly' or 'bob-casey')."
      );
    }
    const base = slug.replace(/\.md$/i, "");
    const needles = [
      `[[${base}]]`,
      `[[${base}|`,
      `(${base}.md)`,
      `/${base}.md`
    ].map((n) => n.toLowerCase());
    const files = await listFiles();
    const collected = [];
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
      collected.push({
        path: rel,
        priority: pathPriority(rel),
        snippet: extractSnippet(body, matchIdx, 0)
      });
    }
    // Drop fixture / test-junk results (priority 0). They were polluting
    // backlink lists with diagrams and sample files that aren't real notes.
    const filtered = collected.filter((h) => h.priority > 0);
    filtered.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.path.localeCompare(b.path);
    });
    return filtered.slice(0, limit).map(({ priority, ...rest }) => rest);
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

// Are any two distinct tokens' first occurrences within 100 chars of each other?
// Cheap proxy for "tokens appear in the same context" — used as a relevance
// tiebreaker for multi-word queries.
function computeCoLocate(positions) {
  const present = positions.filter((p) => p >= 0);
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      if (Math.abs(present[i] - present[j]) <= 100) return 1;
    }
  }
  return 0;
}

function countTokenOccurrences(haystackLower, needle) {
  if (!needle) return 0;
  let n = 0;
  let idx = 0;
  while ((idx = haystackLower.indexOf(needle, idx)) !== -1) {
    n++;
    idx += needle.length;
  }
  return n;
}

function firstNonEmptyLine(body) {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.slice(0, 200);
  }
  return "";
}
