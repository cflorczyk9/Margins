// Entity candidate scan — surface capitalized N-grams that recur across many
// files but have no matching vault slug. The inverse of propose_wikilinks
// (which only suggests links to slugs that already exist). Closes the A3
// cold-start gap: a med-school vault mentions "Krebs cycle" in 60 files
// without ever having a Krebs page; propose_wikilinks can't see that, this
// can.
//
// Output is suggestions only — never stages. propose_entity_stubs (Phase 6)
// consumes this output and stages stub pages. Keeping read and stage in
// separate tools lets the user filter the candidate list before committing
// to a wall of new pages.
import { readFile } from "node:fs/promises";
import { buildSlugIndex } from "./vault-slug-index.js";
import { globMatch } from "./paths.js";
import { getType, parseFrontmatter } from "./frontmatter.js";

const DEFAULT_MIN_MENTIONS = 5;
const DEFAULT_MIN_FILE_SPREAD = 3;
const DEFAULT_LIMIT = 50;
const DEFAULT_SCOPE = "wiki/**";
const DEFAULT_MIN_PHRASE_WORDS = 2;
const SNIPPET_CTX = 60;

// Acronym-shaped single-word phrases (all caps, 2-6 letters) are accepted
// regardless of minPhraseWords. Catches AI / MBA / MCP / API / DOJ etc.
const ACRONYM_RE = /^[A-Z]{2,6}$/;

// Global English + structural-heading stoplist. Anything here is dropped
// before the domain pack even looks. These are slugified at lookup time.
const GLOBAL_STOPLIST = new Set([
  // pronouns + articles (uppercased phrases that aren't real entities)
  "the", "and", "for", "with", "from", "this", "that", "these", "those",
  "have", "has", "had", "was", "were", "are", "but", "not", "you", "your",
  "all", "any", "some", "into", "out", "over", "under", "after", "before",
  "about", "against", "between", "through", "during", "above", "below",
  // months and weekdays
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  // common structural headings in any vault
  "summary", "overview", "notes", "todo", "to-do", "tldr", "tl-dr",
  "introduction", "conclusion", "background", "context", "appendix",
  "references", "related", "see-also", "next-steps", "open-questions",
  "agenda", "minutes", "action-items", "follow-up", "key-points",
  // Margins-specific bucket names that show up in body text
  "wiki", "sources", "raw", "projects", "ideas", "entities", "concepts",
  "synthesis", "meetings", "career", "personal", "daily",
  // very common adjectives that get title-cased in sentence starts
  "the-new", "the-old", "first", "second", "third", "next", "last",
  // citation noise
  "et-al", "ibid", "id", "supra", "infra",
  // sentence-start common words (caught by capitalized-N-gram regex when at
  // the start of a line/sentence). These were the dominant noise on a 1300-
  // file vault: "No", "If", "What", "Do", "So", etc.
  "no", "if", "what", "when", "where", "who", "why", "how", "which", "yes",
  "do", "does", "did", "doing", "done", "is", "are", "was", "were", "be",
  "it", "in", "on", "at", "of", "to", "as", "an", "or", "we", "us", "i",
  "you", "your", "he", "him", "she", "her", "they", "them",
  "so", "re", "co", "pre", "per", "don", "yet", "now", "then", "here",
  "there", "just", "also", "even", "only", "still", "well", "ok",
  "use", "user", "users", "page", "section", "part", "thing", "things",
  "way", "ways", "case", "cases", "point", "points", "fact", "facts",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "open", "close", "yes-no", "true-false", "tbd", "wip"
]);

// Domain packs — pre-curated stoplists per common vault type. Keeps recall
// high in the default config; user opts into the pack matching their corpus.
const DOMAIN_PACKS = {
  generic: new Set(),
  med: new Set([
    "first-aid", "step-one", "step-two", "step-three", "chapter-one",
    "gram-positive", "gram-negative", "t-cell", "b-cell", "class-i", "class-ii",
    "stage-i", "stage-ii", "stage-iii", "stage-iv",
    "chief-complaint", "review-of-systems", "physical-exam", "differential",
    "history-of-present-illness", "social-history", "family-history",
    "vital-signs", "labs", "imaging", "treatment-plan", "discharge", "admit",
    "year-one", "year-two", "first-year", "second-year"
  ]),
  realestate: new Set([
    "class-a", "class-b", "class-c", "phase-i", "phase-ii", "phase-iii",
    "due-diligence", "loi", "psa", "noi", "irr", "cap-rate",
    "main-street", "first-avenue", "north", "south", "east", "west",
    "march-rent", "april-rent", "may-rent",
    "total-sq-ft", "rentable-sq-ft", "common-area"
  ]),
  law: new Set([
    "section", "chapter", "article", "subsection", "clause", "subclause",
    "title", "part", "subpart", "paragraph",
    "first-amendment", "second-amendment", "fourteenth-amendment",
    "case", "docket", "exhibit", "appendix"
  ])
};

const SYSTEM_PAGE_TYPES = new Set(["tracker", "system", "log", "index"]);

const META_PAGES = new Set([
  "wiki/ingest-tracker.md",
  "wiki/wiki-stats.md",
  "wiki/log.md",
  "wiki/index.md"
]);

export async function scanEntityCandidates(vault, options = {}) {
  const {
    scope = DEFAULT_SCOPE,
    minMentions = DEFAULT_MIN_MENTIONS,
    minFileSpread = DEFAULT_MIN_FILE_SPREAD,
    domain = "generic",
    limit = DEFAULT_LIMIT,
    excludeUserRejections = [],
    // Minimum word count for a non-acronym candidate. Default 2 because
    // single-word capitalized matches at sentence starts are the dominant
    // noise source on real vaults ("No, ", "If you ", "Do you ", etc.).
    // Acronyms (AI / MBA / MCP) are accepted regardless because they're
    // unambiguous entity shapes. Drop to 1 if you want to surface bare
    // surnames or short names ("Holmes", "Cardozo").
    minPhraseWords = DEFAULT_MIN_PHRASE_WORDS
  } = options;

  if (!Object.prototype.hasOwnProperty.call(DOMAIN_PACKS, domain)) {
    throw new Error(`unknown domain '${domain}'. Use one of: ${Object.keys(DOMAIN_PACKS).join(", ")}.`);
  }

  // Build the slug index ONCE for the whole scan. Same shared-index win
  // as scope-mode wikilinks; the inverse query just asks "what's NOT here."
  const slugIndex = await buildSlugIndex(vault);

  const allFiles = await vault.listFiles();
  const userRejected = new Set(excludeUserRejections.map((s) => slugify(s)));
  const stoplist = buildEffectiveStoplist(domain, userRejected);

  // First pass: collect (phrase, slug) emissions per file, plus first-snippet
  // per (file, slug). Body reads dominate — defer to a single pass.
  const candidates = new Map(); // slug → { phrase, slug, mentionCount, files: Set, snippets: [] }
  let filesScanned = 0;

  for (const abs of allFiles) {
    const rel = vault.toRel(abs);
    if (!rel.endsWith(".md")) continue;
    if (META_PAGES.has(rel)) continue;
    if (!globMatch(scope, rel)) continue;

    let body;
    try { body = await readFile(abs, "utf8"); }
    catch { continue; }

    // Skip system-typed pages so headings inside the tracker don't pollute.
    if (isSystemPage(body)) continue;

    filesScanned += 1;
    const seenInThisFile = new Map(); // slug → phrase (first occurrence canonical)
    for (const { phrase, slug, index } of extractCapitalizedNGrams(body)) {
      // Minimum word count filter — single-word non-acronyms are dominant
      // noise on real vaults (sentence-start capitals). Acronyms pass
      // regardless because they're unambiguous entity shapes.
      const wordCount = phrase.split(/\s+/).length;
      if (wordCount < minPhraseWords && !ACRONYM_RE.test(phrase)) continue;
      if (!seenInThisFile.has(slug)) seenInThisFile.set(slug, { phrase, index });
    }

    for (const [slug, { phrase, index }] of seenInThisFile) {
      let entry = candidates.get(slug);
      if (!entry) {
        entry = {
          phrase,
          slug,
          mentionCount: 0,
          files: new Set(),
          snippets: []
        };
        candidates.set(slug, entry);
      }
      // Count every appearance in the file, not just one per file. Frequency
      // matters as much as spread.
      entry.mentionCount += countOccurrences(body, phrase);
      entry.files.add(rel);
      if (entry.snippets.length < 3) {
        entry.snippets.push({ file: rel, snippet: snippetAround(body, index) });
      }
    }
  }

  // Filter: drop existing slugs, stoplist, below-threshold.
  const filtered = [];
  let excludedExistingSlugs = 0;
  let excludedStoplist = 0;
  let excludedBelowThreshold = 0;
  for (const entry of candidates.values()) {
    if (slugIndex.slugToFile.has(entry.slug)) {
      excludedExistingSlugs += 1;
      continue;
    }
    if (stoplist.has(entry.slug)) {
      excludedStoplist += 1;
      continue;
    }
    if (entry.mentionCount < minMentions || entry.files.size < minFileSpread) {
      excludedBelowThreshold += 1;
      continue;
    }
    filtered.push(entry);
  }

  // Rank by file spread × mention count. A name in 30 files with 50 mentions
  // is more load-bearing than a name in 2 files with 50 mentions.
  filtered.sort((a, b) =>
    (b.files.size * b.mentionCount) - (a.files.size * a.mentionCount) ||
    b.files.size - a.files.size ||
    b.mentionCount - a.mentionCount ||
    a.slug.localeCompare(b.slug)
  );

  const top = filtered.slice(0, limit).map((entry) => ({
    phrase: entry.phrase,
    slug: entry.slug,
    mentionCount: entry.mentionCount,
    fileCount: entry.files.size,
    snippets: entry.snippets.slice(0, 2),
    files: Array.from(entry.files).slice(0, 10)
  }));

  return {
    scope,
    domain,
    filesScanned,
    candidatesFound: filtered.length,
    excludedExistingSlugs,
    excludedStoplist,
    excludedBelowThreshold,
    candidates: top,
    truncated: filtered.length > top.length
  };
}

function buildEffectiveStoplist(domain, userRejected) {
  const out = new Set();
  for (const s of GLOBAL_STOPLIST) out.add(s);
  for (const s of DOMAIN_PACKS[domain]) out.add(s);
  for (const s of userRejected) if (s) out.add(s);
  return out;
}

function isSystemPage(body) {
  let parsed;
  try { parsed = parseFrontmatter(body); } catch { return false; }
  if (!parsed) return false;
  const type = getType(parsed.data);
  if (SYSTEM_PAGE_TYPES.has(type)) return true;
  if (parsed.data && parsed.data.bucket === "system") return true;
  return false;
}

// Capitalized N-gram extractor. Generator yields {phrase, slug, index} for
// every match. Strips wikilinks first so [[Foo Bar]] doesn't generate a
// candidate for "Foo Bar" (it's already linked elsewhere — if a wikilink
// target page exists, the slug-index filter drops it; if not, the user
// hand-authored the link and we should respect that, not propose a stub).
const WIKILINK_PLACEHOLDER = " WLINK ";
function* extractCapitalizedNGrams(body) {
  // Replace wikilinks with a placeholder of the same length so character
  // indexes stay aligned to the original body (snippet finder uses them).
  const cleaned = body.replace(/\[\[([^|\]]+)(?:\|[^\]]*)?\]\]/g, (match) =>
    WIKILINK_PLACEHOLDER.repeat(Math.ceil(match.length / WIKILINK_PLACEHOLDER.length)).slice(0, match.length)
  );
  // Same shape as the wikilinks regex — capitalized first word + up to 3
  // capitalized followers. Single capitalized words are deliberately allowed
  // ("Hodgkin", "Cardozo") since those are exactly the entity-stub targets
  // entity scan is meant to surface.
  const re = /\b[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,3}\b/g;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    // Skip matches that overlap a wikilink placeholder.
    if (m[0].includes(WIKILINK_PLACEHOLDER[0])) continue;
    const phrase = m[0];
    const slug = slugify(phrase);
    if (!slug) continue;
    // Single-letter slugs (just "I", "A") slip through the capitalized
    // regex sometimes when sentence-starts get matched. Drop them.
    if (slug.length < 2) continue;
    yield { phrase, slug, index: m.index };
  }
}

function snippetAround(body, index, ctx = SNIPPET_CTX) {
  const start = Math.max(0, index - ctx);
  const end = Math.min(body.length, index + ctx);
  let s = body.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) s = "…" + s;
  if (end < body.length) s = s + "…";
  return s;
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
}

function slugify(phrase) {
  return String(phrase || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
