/**
 * Pure data-transformation helpers for the Quiet Files tab.
 * No DOM, no state mutation. Ported from
 * margins/scripts/build-spread-quiet-real.py.
 */

const BUCKET_FOR_FOLDER = {
  entities: 'entities',
  personal: 'entities',
  health: 'entities',
  finance: 'entities',
  career: 'career',
  concepts: 'concepts',
  ideas: 'concepts',
  projects: 'concepts',
  coding: 'concepts',
  entertainment: 'concepts',
  'bucket-list': 'concepts',
  sources: 'sources',
  daily: 'sources',
  sessions: 'sources',
  outbound: 'sources',
  activities: 'sources',
  synthesis: 'synthesis',
  queries: 'synthesis',
};

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const WIKILINK_RE = /\[\[([^\]]+?)\]\]/g;

/**
 * Map a vault path → one of: entities | career | concepts | sources | synthesis | meta.
 * @param {string} path Vault-relative path (e.g. "wiki/daily/2026-05-10.md").
 * @returns {"entities"|"career"|"concepts"|"sources"|"synthesis"|"meta"}
 */
export function quietBucketForPath(path) {
  if (!path || typeof path !== 'string') return 'meta';
  const parts = path.split('/').filter(Boolean);
  // Non-wiki or root operating files → meta.
  if (parts.length === 0) return 'meta';
  if (parts[0] !== 'wiki') return 'meta';
  // wiki/file.md (no folder) → meta.
  if (parts.length <= 2) return 'meta';
  const folder = parts[1];
  return BUCKET_FOR_FOLDER[folder] || 'meta';
}

/**
 * Relative age string from an epoch-ms timestamp.
 * @param {number|undefined} mtimeMs Modified time in ms; undefined → "—".
 * @param {number} [nowMs] Now in ms (override for tests).
 * @returns {string}
 */
export function quietRelativeAge(mtimeMs, nowMs = Date.now()) {
  if (mtimeMs === undefined || mtimeMs === null || Number.isNaN(mtimeMs)) return '—';
  const deltaSec = Math.max(0, (nowMs - mtimeMs) / 1000);
  if (deltaSec < 60) return 'now';
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h`;
  if (deltaSec < 86400 * 30) return `${Math.floor(deltaSec / 86400)}d`;
  if (deltaSec < 86400 * 365) return `${Math.floor(deltaSec / (86400 * 30))}mo`;
  return `${Math.floor(deltaSec / (86400 * 365))}y`;
}

/**
 * Parse YAML-ish frontmatter into a flat {key: string|string[]} object.
 * Supports inline arrays, indented block lists, and quoted strings.
 * @param {string} body Raw file text.
 * @returns {Object<string, string|string[]>}
 */
export function quietParseFrontmatter(body) {
  if (!body || typeof body !== 'string') return {};
  const m = FRONTMATTER_RE.exec(body);
  if (!m) return {};
  const raw = m[1];
  const fm = {};
  let currentKey = null;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    // Block-list continuation lines: "  - value" or "- value".
    const listMatch = /^\s*-\s+(.*)$/.exec(line);
    if (listMatch && currentKey && !line.includes(':')) {
      const val = listMatch[1].trim().replace(/^['"]|['"]$/g, '');
      if (!Array.isArray(fm[currentKey])) fm[currentKey] = [];
      fm[currentKey].push(val);
      continue;
    }
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const valRaw = line.slice(idx + 1).trim();
    currentKey = key;
    if (!valRaw) {
      fm[key] = [];
    } else if (valRaw.startsWith('[') && valRaw.endsWith(']')) {
      const inner = valRaw.slice(1, -1);
      fm[key] = inner
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else {
      fm[key] = valRaw.replace(/^['"]|['"]$/g, '');
    }
  }
  return fm;
}

/**
 * Strip the leading frontmatter block from a body.
 * @param {string} body
 * @returns {string}
 */
export function quietStripFrontmatter(body) {
  if (!body || typeof body !== 'string') return '';
  const m = FRONTMATTER_RE.exec(body);
  if (!m) return body;
  return body.slice(m[0].length);
}

function replaceWikilinks(text) {
  return text.replace(WIKILINK_RE, (_, inner) => {
    const parts = inner.split('|');
    return (parts[parts.length - 1] || '').trim();
  });
}

/**
 * Pretty title — frontmatter title, else first H1, else prettified filename.
 * @param {string} path
 * @param {string} body
 * @returns {string}
 */
export function quietPrettyTitle(path, body) {
  const fm = quietParseFrontmatter(body);
  if (typeof fm.title === 'string' && fm.title) return fm.title;
  const stripped = quietStripFrontmatter(body);
  for (const line of stripped.split('\n')) {
    if (line.startsWith('# ')) return line.slice(2).trim();
  }
  const filename = (path || '').split('/').pop() || '';
  const stem = filename.replace(/\.md$/i, '').replace(/[-_]/g, ' ');
  if (!stem) return path || 'Untitled';
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

/**
 * Tags from frontmatter (top-of-file YAML). Capped at 6.
 * @param {string} body
 * @returns {string[]}
 */
export function quietTagsFromBody(body) {
  const fm = quietParseFrontmatter(body);
  let raw = fm.tags;
  if (raw === undefined) raw = fm.tag;
  if (raw === undefined || raw === null) return [];
  if (typeof raw === 'string') raw = [raw];
  if (!Array.isArray(raw)) return [];
  return raw.filter((t) => typeof t === 'string' && t.trim()).slice(0, 6);
}

/**
 * First-paragraph excerpt, capped at ~maxChars.
 * Drops headings, table rules, bullet markers; collapses whitespace.
 * @param {string} body
 * @param {number} [maxChars]
 * @returns {string}
 */
export function quietExcerptFromBody(body, maxChars = 380) {
  const stripped = quietStripFrontmatter(body || '');
  const text = replaceWikilinks(stripped);
  const paragraphs = [];
  for (let chunk of text.split(/\n\s*\n/)) {
    chunk = chunk.trim();
    if (!chunk) continue;
    if (chunk.startsWith('#')) continue;
    if (chunk.startsWith('|') || chunk.startsWith('---')) continue;
    chunk = chunk.replace(/^[-*]\s+/gm, '');
    chunk = chunk.replace(/\s+/g, ' ');
    if (chunk.length < 20) continue;
    paragraphs.push(chunk);
    if (paragraphs.reduce((n, p) => n + p.length, 0) > maxChars * 2) break;
  }
  const joined = paragraphs.join(' ');
  if (!joined) return 'No body content yet.';
  if (joined.length <= maxChars) return joined.trimEnd();
  return joined.slice(0, maxChars).trimEnd() + '…';
}

/**
 * Continuation excerpt — starts after the first `afterChars` of cleaned body.
 * @param {string} body
 * @param {number} [afterChars]
 * @param {number} [maxChars]
 * @returns {string}
 */
export function quietExtendedFromBody(body, afterChars = 380, maxChars = 400) {
  const stripped = quietStripFrontmatter(body || '');
  let text = replaceWikilinks(stripped);
  text = text.replace(/^#+\s.*$/gm, '');
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length <= afterChars) return '';
  const rest = text.slice(afterChars, afterChars + maxChars).trim();
  if (!rest) return '';
  return rest + (text.length > afterChars + maxChars ? '…' : '');
}

/**
 * Word count after stripping markdown chrome + wikilink brackets.
 * @param {string} body
 * @returns {number}
 */
export function quietWordCount(body) {
  if (!body) return 0;
  const stripped = quietStripFrontmatter(body);
  let text = replaceWikilinks(stripped);
  text = text.replace(/[#*_`>\-]+/g, ' ');
  return text.split(/\s+/).filter((w) => w.trim()).length;
}

/**
 * Connections from [[wikilinks]] in body, resolved against allPaths when possible.
 * @param {string} body
 * @param {Set<string>|null|undefined} allPaths Known vault paths.
 * @returns {Array<{label: string, target: string|null}>}
 */
export function quietConnectionsFromBody(body, allPaths) {
  if (!body) return [];
  const known = allPaths instanceof Set ? allPaths : new Set(allPaths || []);
  const out = [];
  const seen = new Set();
  const stripped = quietStripFrontmatter(body);
  const re = new RegExp(WIKILINK_RE.source, 'g');
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const raw = (m[1].split('|')[0] || '').trim();
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    const candidates = [
      `wiki/${raw}.md`,
      `wiki/${raw}`,
      `wiki/entities/${raw}.md`,
      `wiki/career/${raw}.md`,
      `wiki/concepts/${raw}.md`,
      `wiki/sources/${raw}.md`,
      `wiki/synthesis/${raw}.md`,
      `wiki/projects/${raw}.md`,
    ];
    const target = candidates.find((p) => known.has(p)) || null;
    const pretty = raw.replace(/[-_]/g, ' ');
    const label = pretty ? pretty.charAt(0).toUpperCase() + pretty.slice(1) : raw;
    out.push({ label, target });
    if (out.length >= 6) break;
  }
  return out;
}

function formatLastEditedLabel(mtimeMs) {
  if (mtimeMs === undefined || mtimeMs === null || Number.isNaN(mtimeMs)) return '—';
  const d = new Date(mtimeMs);
  if (Number.isNaN(d.getTime())) return '—';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

/**
 * Build the full file record consumed by the Quiet renderer.
 * Returns {path, title, bucket, age, words, lastEditedLabel, tags, connections, excerpt, extended}.
 * @param {string} path
 * @param {string} body
 * @param {Map<string,string>} fileMap state.currentFileMap
 * @param {Map<string,number>} [mtimes] path → epoch ms
 * @returns {Object}
 */
export function quietBuildFileRecord(path, body, fileMap, mtimes) {
  const mtime = mtimes && typeof mtimes.get === 'function' ? mtimes.get(path) : undefined;
  const allPaths = fileMap && typeof fileMap.keys === 'function'
    ? new Set(fileMap.keys())
    : new Set();
  return {
    path,
    title: quietPrettyTitle(path, body || ''),
    bucket: quietBucketForPath(path),
    age: quietRelativeAge(mtime),
    mtime: typeof mtime === 'number' ? mtime : undefined,
    words: quietWordCount(body || ''),
    lastEditedLabel: formatLastEditedLabel(mtime),
    tags: quietTagsFromBody(body || ''),
    connections: quietConnectionsFromBody(body || '', allPaths),
    excerpt: quietExcerptFromBody(body || ''),
    extended: quietExtendedFromBody(body || ''),
  };
}

/**
 * Build all file records, sorted by recency descending.
 * Filters out non-vault paths (anything not under wiki/ AND not a root operating file).
 * @param {Map<string,string>} fileMap
 * @param {Map<string,number>} [mtimes]
 * @returns {Array}
 */
export function quietBuildAllRecords(fileMap, mtimes) {
  if (!fileMap || typeof fileMap.keys !== 'function') return [];
  const records = [];
  for (const path of fileMap.keys()) {
    if (typeof path !== 'string' || !path) continue;
    if (!path.endsWith('.md')) continue;
    const body = fileMap.get(path) || '';
    records.push(quietBuildFileRecord(path, body, fileMap, mtimes));
  }
  records.sort((a, b) => {
    const am = mtimes && mtimes.get ? mtimes.get(a.path) : undefined;
    const bm = mtimes && mtimes.get ? mtimes.get(b.path) : undefined;
    const aVal = typeof am === 'number' ? am : -Infinity;
    const bVal = typeof bm === 'number' ? bm : -Infinity;
    if (bVal !== aVal) return bVal - aVal;
    return a.path.localeCompare(b.path);
  });
  return records;
}

/**
 * Aggregate stats for the pull-quote header.
 * @param {Array} records
 * @returns {{totalFiles: number, totalWords: number, lastEditedAge: string}}
 */
export function quietAggregateStats(records) {
  const list = Array.isArray(records) ? records : [];
  const totalFiles = list.length;
  let totalWords = 0;
  for (const r of list) totalWords += Number(r && r.words) || 0;
  const lastEditedAge = list.length && list[0] && list[0].age ? list[0].age : '—';
  return { totalFiles, totalWords, lastEditedAge };
}

/**
 * Filter records against a search query.
 * Matches title, path, tags, and connection labels (case-insensitive).
 * Empty query → null (caller treats as "all match").
 * @param {Array} records
 * @param {string} query
 * @returns {Set<string>|null}
 */
export function quietSearchMatches(records, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return null;
  const out = new Set();
  for (const r of records || []) {
    if (!r || typeof r.path !== 'string') continue;
    const hay = [];
    if (r.title) hay.push(String(r.title).toLowerCase());
    hay.push(r.path.toLowerCase());
    if (Array.isArray(r.tags)) hay.push(r.tags.join(' ').toLowerCase());
    if (Array.isArray(r.connections)) {
      hay.push(r.connections.map((c) => (c && c.label) || '').join(' ').toLowerCase());
    }
    if (hay.some((h) => h.includes(q))) out.add(r.path);
  }
  return out;
}
