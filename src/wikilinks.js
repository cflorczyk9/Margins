import path from "node:path";
import { stat } from "node:fs/promises";
import { getType, parseFrontmatter } from "./frontmatter.js";
import { buildSlugIndex } from "./vault-slug-index.js";

// Wikilink suggester for A3/B3 personas: vaults with lots of markdown but
// few [[wikilinks]]. Two modes:
//   1. Single-page (the original): pass `path`, get a ranked list of
//      candidate {phrase, wikilink, occurrences} suggestions.
//   2. Scope (new in v0.15): pass `scope` glob/folder, get aggregated
//      suggestions across every matching page using one shared slug
//      index. With apply=true, stages one rewritten page per scanned
//      page (replacing every candidate phrase with its wikilink in a
//      single propose_page proposal, NOT N propose_edit calls — those
//      collide on string uniqueness when phrases recur or stack).

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "have", "has", "had",
  "was", "were", "are", "but", "not", "you", "your", "all", "any", "some",
  "into", "out", "over", "under", "after", "before", "about", "against",
  "between", "through", "during", "above", "below", "to", "of", "in", "on",
  "by", "as", "is", "it", "be", "at", "an", "or", "if", "we", "he", "she",
  "they", "them", "their", "there", "here", "what", "when", "where", "who",
  "why", "how", "which"
]);

const DEFAULT_MAX_PAGES = 50;
const DEFAULT_MAX_SUGGESTIONS = 15;

export function createWikilinks(vault, options = {}) {
  // proposals is optional; only required for apply mode.
  const proposals = options.proposals || null;

  async function proposeWikilinks(pagePath, callOptions = {}) {
    // Branch: scope-mode (bulk) when scope is set OR path is missing
    // alongside scope. Single-page mode remains the default to preserve
    // the original tool contract.
    if (callOptions.scope) {
      return await runScopeMode(pagePath, callOptions);
    }
    return await runSinglePageMode(pagePath, callOptions);
  }

  async function runSinglePageMode(pagePath, callOptions) {
    const maxSuggestions = callOptions.maxSuggestions ?? DEFAULT_MAX_SUGGESTIONS;
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
    const index = await buildSlugIndex(vault, { excludePath: pagePath });
    const ranked = scanPageForSuggestions(body, index.slugToFile, maxSuggestions);
    return {
      page: page.path,
      candidatesScanned: ranked.totalCandidates,
      vaultSlugsAvailable: index.totalSlugs,
      suggestions: ranked.suggestions
    };
  }

  async function runScopeMode(initialPath, callOptions) {
    const scope = callOptions.scope;
    const maxPages = clampMaxPages(callOptions.maxPages);
    const maxSuggestions = callOptions.maxSuggestions ?? DEFAULT_MAX_SUGGESTIONS;
    const apply = Boolean(callOptions.apply);

    if (apply && !proposals) {
      throw new Error("propose_wikilinks apply=true requires the proposals module — pass it to createWikilinks.");
    }

    // Build the slug index ONCE for the whole scope walk. This is the
    // entire reason scope mode exists: per-call rebuild of the index is
    // the dominant cost for folder-scale operations.
    const index = await buildSlugIndex(vault);

    const targets = await collectScopePages(vault, scope, maxPages);
    if (!targets.length) {
      return {
        scope,
        vaultSlugsAvailable: index.totalSlugs,
        pagesScanned: 0,
        pages: [],
        aggregatedSuggestions: [],
        apply,
        applied: 0
      };
    }

    const pageResults = [];
    const aggregated = new Map(); // wikilink → {wikilink, targetPath, totalOccurrences, pageCount}

    for (const target of targets) {
      let page;
      try {
        page = await vault.readPage(target);
      } catch {
        continue;
      }
      const skip = systemPageSkipReason(page.path, page.body);
      if (skip) {
        pageResults.push({ page: page.path, skipped: true, reason: skip, suggestions: [] });
        continue;
      }
      // Per-page slug index excludes the page itself so we don't suggest
      // a self-link. The shared index is the slow part; this re-derivation
      // is just a per-page Map filter.
      const perPageIndex = filterIndexExcluding(index.slugToFile, page.path);
      const ranked = scanPageForSuggestions(page.body, perPageIndex, maxSuggestions);
      const entry = {
        page: page.path,
        suggestions: ranked.suggestions
      };
      pageResults.push(entry);

      for (const s of ranked.suggestions) {
        const key = s.wikilink;
        const prior = aggregated.get(key);
        if (prior) {
          prior.totalOccurrences += s.occurrences;
          prior.pageCount += 1;
        } else {
          aggregated.set(key, {
            wikilink: s.wikilink,
            targetPath: s.targetPath,
            totalOccurrences: s.occurrences,
            pageCount: 1
          });
        }
      }
    }

    let appliedCount = 0;
    const appliedPages = [];
    const skippedDueToPending = [];
    if (apply) {
      for (const pr of pageResults) {
        if (pr.skipped || !pr.suggestions.length) continue;
        // Refuse to rewrite a page that already has a pending proposal. If
        // we proceeded, force:true would overwrite that proposal with a
        // rewrite of the LANDED vault body — silently dropping whatever
        // staged edits were waiting for review. Let the user resolve the
        // existing proposal first.
        const pendingAbs = vault.resolveInside(`proposed/${pr.page}`);
        const hasPending = await pathExists(pendingAbs);
        if (hasPending) {
          pr.skippedDueToPendingProposal = true;
          skippedDueToPending.push(pr.page);
          continue;
        }
        const page = await vault.readPage(pr.page);
        const rewritten = applyWikilinksToBody(page.body, pr.suggestions);
        if (rewritten === page.body) continue;
        const result = await proposals.proposePage(pr.page, rewritten, { force: true });
        appliedCount += 1;
        appliedPages.push({ page: pr.page, proposalPath: result.proposalPath, suggestionsApplied: pr.suggestions.length });
      }
    }

    const aggregatedSuggestions = Array.from(aggregated.values())
      .sort((a, b) => b.totalOccurrences - a.totalOccurrences || b.pageCount - a.pageCount);

    return {
      scope,
      vaultSlugsAvailable: index.totalSlugs,
      pagesScanned: pageResults.length,
      pages: pageResults,
      aggregatedSuggestions,
      apply,
      applied: appliedCount,
      appliedPages,
      skippedDueToPending
    };
  }

  async function pathExists(abs) {
    try { await stat(abs); return true; }
    catch { return false; }
  }

  return { proposeWikilinks };
}

function scanPageForSuggestions(body, slugToFile, maxSuggestions) {
  const alreadyLinked = collectExistingLinks(body);
  const candidates = findCandidatePhrases(body, slugToFile, alreadyLinked);
  const counts = new Map();
  for (const c of candidates) {
    const key = c.phrase + "→" + c.slug;
    const entry = counts.get(key) || { ...c, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  const ranked = [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, maxSuggestions)
    .map((r) => ({
      phrase: r.phrase,
      wikilink: `[[${r.slug}]]`,
      targetPath: r.targetPath,
      occurrences: r.count
    }));
  return { totalCandidates: candidates.length, suggestions: ranked };
}

function filterIndexExcluding(slugToFile, excludePath) {
  // The shared index might contain a slug entry whose `rel` IS the page
  // we're scanning. Drop those to avoid self-linking. Cheaper than
  // rebuilding the whole index.
  const filtered = new Map();
  for (const [key, val] of slugToFile) {
    if (val.rel === excludePath) continue;
    filtered.set(key, val);
  }
  return filtered;
}

async function collectScopePages(vault, scope, maxPages) {
  // Reuse the path-matching machinery from list_proposals.
  const { globMatch } = await import("./paths.js");
  const allFiles = await vault.listFiles();
  const out = [];
  for (const abs of allFiles) {
    const rel = vault.toRel(abs);
    if (!rel.endsWith(".md")) continue; // wikilinks only meaningful on markdown
    if (!globMatch(scope, rel)) continue;
    out.push(rel);
    if (out.length >= maxPages) break;
  }
  return out;
}

function applyWikilinksToBody(body, suggestions) {
  // Replace every occurrence of each suggestion phrase with its wikilink,
  // honoring word boundaries so substring matches inside other words don't
  // corrupt the body. Existing wikilinks are not touched — the suggestion
  // set already excludes phrases inside [[ ... ]], but the body may contain
  // wikilinks to OTHER targets that contain a phrase we'd otherwise rewrite
  // (e.g., the alias inside [[long-target-name|Bob Casey]]).
  //
  // Precompute the exact [[…]] ranges in the current body for each pass.
  // Previously used a 50-char lookbehind which broke for long target/alias
  // pairs (`[[very-long-target-name-over-50-chars|Acme]]` would let "Acme"
  // get re-wrapped into `[[acme]]`, producing nested wikilinks). Range-based
  // checking is O(N+matches) per suggestion and exact.
  let out = body;
  for (const s of suggestions) {
    const phrase = s.phrase;
    const link = s.wikilink;
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "g");

    const ranges = findWikilinkRanges(out);
    const matches = [];
    let m;
    while ((m = re.exec(out)) !== null) {
      if (!isInsideAnyRange(ranges, m.index)) {
        matches.push({ start: m.index, end: m.index + m[0].length });
      }
    }
    // Apply in reverse so earlier substitutions don't shift later offsets.
    for (let i = matches.length - 1; i >= 0; i--) {
      const { start, end } = matches[i];
      out = out.slice(0, start) + link + out.slice(end);
    }
  }
  return out;
}

function findWikilinkRanges(body) {
  const ranges = [];
  // Greedy [[…]] match — pairs of brackets with nothing closing in between.
  // Tolerates pipes (aliases) and any non-]] content. If a [[ has no closing
  // ]], it's malformed; we skip it (range list excludes it, so substitutions
  // inside the unfinished link can happen — acceptable degradation for
  // pathological input).
  const re = /\[\[[^\]]*?\]\]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

function isInsideAnyRange(ranges, offset) {
  for (const [start, end] of ranges) {
    if (offset >= start && offset < end) return true;
    if (start > offset) return false; // ranges are ordered; short-circuit
  }
  return false;
}

function clampMaxPages(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_MAX_PAGES;
  if (n < 1) return 1;
  if (n > 500) return 500;
  return Math.floor(n);
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
  const wordRe = /\b[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,3}\b/g;
  let m;
  while ((m = wordRe.exec(body)) !== null) {
    const phrase = m[0];
    const slug = slugify(phrase);
    if (!slug || STOPWORDS.has(slug)) continue;
    if (alreadyLinked.has(slug)) continue;
    const match = slugToFile.get(slug);
    if (match) {
      out.push({ phrase, slug: match.slug, targetPath: match.rel });
    }
  }
  const slugRe = /\b[a-z][a-z0-9]+(?:[-_][a-z0-9]+)+\b/g;
  while ((m = slugRe.exec(body)) !== null) {
    const literal = m[0];
    const slug = literal.replace(/_/g, "-");
    if (alreadyLinked.has(slug)) continue;
    const match = slugToFile.get(slug);
    if (match) {
      out.push({ phrase: literal, slug: match.slug, targetPath: match.rel });
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
