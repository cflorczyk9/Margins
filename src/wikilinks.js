import path from "node:path";
import { getType, parseFrontmatter } from "./frontmatter.js";

// Lightweight wikilink suggester for A3/B3 personas: vaults that have lots of
// markdown but few [[wikilinks]]. The model passes a target page; this scans
// the body for entity-shaped phrases that match existing vault file slugs
// and proposes a list of {original, replacement, slug, file} edits.

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "have", "has", "had",
  "was", "were", "are", "but", "not", "you", "your", "all", "any", "some",
  "into", "out", "over", "under", "after", "before", "about", "against",
  "between", "through", "during", "above", "below", "to", "of", "in", "on",
  "by", "as", "is", "it", "be", "at", "an", "or", "if", "we", "he", "she",
  "they", "them", "their", "there", "here", "what", "when", "where", "who",
  "why", "how", "which"
]);

export function createWikilinks(vault) {
  async function proposeWikilinks(pagePath, options = {}) {
    const maxSuggestions = options.maxSuggestions ?? 15;

    const page = await vault.readPage(pagePath);
    const body = page.body;
    const skipReason = systemPageSkipReason(page.path, body);
    if (skipReason) {
      return {
        page: page.path,
        candidatesScanned: 0,
        vaultSlugsAvailable: 0,
        suggestions: [],
        skipped: true,
        reason: skipReason
      };
    }

    const allFiles = await vault.listFiles();
    const slugToFile = new Map();
    for (const abs of allFiles) {
      const rel = vault.toRel(abs);
      if (rel === pagePath) continue;
      const base = path.basename(abs, path.extname(abs));
      // Skip "source-<slug>.md" prefixes — those are bucket-prefixed.
      const slug = base.replace(/^source-/, "");
      if (!slug || slug.length < 3) continue;
      // First slug wins. Same slug in two folders -> we link to the first found.
      if (!slugToFile.has(slug.toLowerCase())) {
        slugToFile.set(slug.toLowerCase(), { slug, rel });
      }
    }

    // Find candidate phrases in the body: capitalized multi-word names + slug-matches.
    const alreadyLinked = collectExistingLinks(body);
    const candidates = findCandidatePhrases(body, slugToFile, alreadyLinked);

    // Score by frequency (how many times the phrase appears in the body).
    const counts = new Map();
    for (const c of candidates) {
      const key = c.phrase + "→" + c.slug;
      const entry = counts.get(key) || { ...c, count: 0 };
      entry.count++;
      counts.set(key, entry);
    }
    const ranked = [...counts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, maxSuggestions);

    return {
      page: page.path,
      candidatesScanned: candidates.length,
      vaultSlugsAvailable: slugToFile.size,
      suggestions: ranked.map((r) => ({
        phrase: r.phrase,
        wikilink: `[[${r.slug}]]`,
        targetPath: r.targetPath,
        occurrences: r.count
      }))
    };
  }

  return { proposeWikilinks };
}

function systemPageSkipReason(pagePath, body) {
  if (pagePath === "wiki/ingest-tracker.md") return "system-page";
  let parsed = null;
  try {
    parsed = parseFrontmatter(body);
  } catch {
    return null;
  }
  if (!parsed) return null;
  const type = getType(parsed.data);
  if (type === "tracker" || type === "system") return "system-page";
  if (parsed.data && parsed.data.bucket === "system") return "system-page";
  return null;
}

function collectExistingLinks(body) {
  const links = new Set();
  const re = /\[\[([^|\]]+)(?:\|[^\]]*)?\]\]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    links.add(m[1].trim().toLowerCase());
  }
  return links;
}

function findCandidatePhrases(body, slugToFile, alreadyLinked) {
  const out = [];

  // Strategy A: scan for capitalized multi-word phrases (potential entity names)
  // and slugify them to check against vault slugs.
  const wordRe = /\b[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,3}\b/g;
  let m;
  while ((m = wordRe.exec(body)) !== null) {
    const phrase = m[0];
    const slug = slugify(phrase);
    if (!slug || STOPWORDS.has(slug)) continue;
    if (alreadyLinked.has(slug)) continue;
    const match = slugToFile.get(slug);
    if (match) {
      out.push({
        phrase,
        slug: match.slug,
        targetPath: match.rel
      });
    }
  }

  // Strategy B: scan for kebab-case or snake_case strings that look like slugs.
  const slugRe = /\b[a-z][a-z0-9]+(?:[-_][a-z0-9]+)+\b/g;
  while ((m = slugRe.exec(body)) !== null) {
    const literal = m[0];
    const slug = literal.replace(/_/g, "-");
    if (alreadyLinked.has(slug)) continue;
    const match = slugToFile.get(slug);
    if (match) {
      out.push({
        phrase: literal,
        slug: match.slug,
        targetPath: match.rel
      });
    }
  }

  return out;
}

function slugify(phrase) {
  return phrase
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
