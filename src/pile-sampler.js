// Pile-mode primer helpers. When a user drops a folder of unstructured files
// in front of margins, "vault stats + folder counts" tells them nothing they
// don't already know. What helps is a representative sample that lets Claude
// say "I see what this is" — recurring names, document shapes, time range.
//
// This module surfaces signal; Claude does the interpretation.

import { readFile, stat } from "node:fs/promises";

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n+/;

// Single capitalized words (3+ chars). Tried multi-word phrases first but a
// greedy "Then Sarah" match swallowed the "Sarah" signal and was then rejected
// as a stopword phrase. Single-word is enough orientation for Claude to act on
// ("I see recurring Sarah, Apex, Mike"); the user doesn't need pre-stitched
// "Mark Loh" — Claude reads the snippets directly.
const CAPITALIZED_RE = /\b[A-Z][a-z]{2,}\b/g;

const STOPWORDS = new Set([
  // Months / days — appear constantly in journals and notes
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
  "Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug", "Sep", "Sept", "Oct", "Nov", "Dec",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
  // Sentence openers and pronouns that get capitalized
  "The", "This", "That", "These", "Those", "When", "Where", "What", "How",
  "Why", "Who", "Which", "And", "But", "Or", "If", "Also", "So", "Then",
  "Now", "Today", "Tomorrow", "Yesterday", "There", "Here", "Some", "Any",
  "All", "Many", "Most", "More", "Less", "First", "Second", "Third",
  "You", "Your", "Yours", "Our", "Their", "His", "Her", "Hers",
  // Note-taking markers
  "TODO", "Note", "Notes", "FIXME", "TBD", "WIP",
  // Common verbs/adverbs that get capitalized at sentence starts
  "Just", "Maybe", "Probably", "Definitely", "Actually", "Really", "Very",
  "Like", "Want", "Need", "Going", "Make", "Made", "Take", "Took",
  "Get", "Got", "Have", "Had", "Will", "Would", "Could", "Should", "Might",
  // Journaling verbs — capitalize at sentence starts, common in notes
  "Talked", "Met", "Saw", "Sent", "Wrote", "Read", "Called", "Texted",
  "Emailed", "Asked", "Said", "Told", "Heard", "Thought", "Felt", "Tried",
  "Decided", "Realized", "Noticed", "Started", "Stopped", "Worked", "Walked",
  "Drove", "Ran", "Spent", "Spoke", "Came", "Went", "Found", "Discussed",
  "Reviewed", "Followed", "Reached", "Mentioned", "Suggested", "Planned",
  // Generic
  "Random", "About", "Around", "After", "Before", "During", "Through",
  "Without", "Within", "Until", "Since", "While", "Although", "Though"
]);

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

export function extractTopPhrases(snippetTexts, options = {}) {
  const limit = options.limit ?? 15;
  const minCount = options.minCount ?? 2;
  const counts = new Map();
  for (const text of snippetTexts) {
    if (!text) continue;
    const matches = text.match(CAPITALIZED_RE) || [];
    for (const m of matches) {
      if (STOPWORDS.has(m)) continue;
      counts.set(m, (counts.get(m) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([phrase, count]) => ({ phrase, count }));
}

const PATTERN_DEFS = [
  { pattern: "dated daily (YYYY-MM-DD)", test: (n) => /\d{4}-\d{2}-\d{2}/.test(n) },
  { pattern: "month-dated (YYYY-MM)",    test: (n) => /\b\d{4}-\d{2}\b(?!-\d)/.test(n) },
  { pattern: "meeting notes",            test: (n) => /^(meeting|mtg)[-_ ]/i.test(n) },
  { pattern: "source pages",             test: (n) => /^source[-_]/i.test(n) },
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
