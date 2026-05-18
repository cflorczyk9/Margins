import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createVault } from "./vault.js";
import { createProposals } from "./proposals.js";
import { detectIndexRoots } from "./index-roots.js";
import { createPrimer, formatSummary } from "./primer.js";
import { createCompile } from "./compile.js";
import { supportedExtensionsList } from "./document-text.js";
import { buildVaultIndex } from "./raw-index.js";
import { diagnoseVault } from "./doctor.js";
import { loadTelemetry, writeConsent, selfTagEnabled } from "./telemetry.js";
import { createPreferences } from "./preferences.js";
import { createWikilinks } from "./wikilinks.js";
import { scanEntityCandidates } from "./entity-scan.js";
import { createVaultContext } from "./vault-context.js";

// Inline SVG of the Margins mark. Embedded as a base64 data URI so the icon
// renders in MCP clients without requiring a network fetch.
const MARGINS_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <style>
    .mark-bg { fill: #faf7f2; stroke: #1a1612; }
    .mark-spine { stroke: #1a1612; }
    .mark-blue { fill: #2c5aa0; }
    .mark-red { fill: #d63a2f; }
    .mark-core { fill: #1a1612; }
    @media (prefers-color-scheme: dark) {
      .mark-bg { fill: #15110d; stroke: #e8e2d6; }
      .mark-spine { stroke: #e8e2d6; }
      .mark-blue { fill: #5b86c9; }
      .mark-red { fill: #e04b3f; }
      .mark-core { fill: #15110d; }
    }
  </style>
  <g fill="none" fill-rule="evenodd" stroke-linecap="round" stroke-linejoin="round">
    <rect class="mark-bg" x="8" y="8" width="48" height="48" rx="11" stroke-width="4"/>
    <path class="mark-spine" stroke-width="7" d="M19 15v34"/>
    <path class="mark-blue" d="M30.8 18.4c7.4-4.6 17.5-.2 19.4 8.2 2.1 9.1-5.2 19.6-14.8 19.6-8.5 0-14.9-8.3-12.9-16.3 1.1-4.7 4.4-9.1 8.3-11.5Z"/>
    <path fill="#f0c14b" d="M33.1 23.3c5.1-3.4 12.1-.8 13.9 4.9 1.8 6.2-3 13.7-9.5 13.8-5.8.1-10.4-5.4-9.4-11 .5-3.3 2.3-6 5-7.7Z"/>
    <path class="mark-red" d="M36.2 27.4c2.8-1.9 6.8-.5 7.8 2.7 1 3.4-1.8 7.5-5.4 7.5-3.1.1-5.8-2.8-5.3-5.9.3-1.8 1.3-3.3 2.9-4.3Z"/>
    <circle class="mark-core" cx="39" cy="33" r="2.4"/>
  </g>
</svg>`;
const MARGINS_ICON_DATA_URI =
  "data:image/svg+xml;base64," + Buffer.from(MARGINS_ICON_SVG).toString("base64");

const OPERATOR_MANUAL = `Margins reads and proposes writes to a Markdown vault on the user's disk.

START EVERY CONVERSATION by calling margins_start once. It returns vault
stats, pending proposals, uningested raw files, recent user preferences,
and the vault's CLAUDE.md if present. Use that context to ground your
answers and follow the user's filing conventions.

ANSWERING: cite specific file paths for every claim you make about the
vault. "Based on wiki/career/career.md, ..." beats "based on your notes."
If you make a claim without a citation, the user can't verify you.

WRITING (everything is a proposal — nothing lands until the user accepts):
- Before propose_edit, call read_page to see current content.
- Before propose_page, call search_vault to check for existing similar pages.
- Before any propose_*, call recall_preferences to follow the user's filing
  conventions and naming patterns. The user's CLAUDE.md and preferences are
  authoritative; your defaults are not.
- Before propose_compile_from_raw, call get_vault_context to see the vault's
  entity slugs, active project slugs, and tag taxonomy. Use those slugs for
  [[wikilinks]] in body sections and key_links frontmatter, those tag names
  for the tags frontmatter (do NOT invent region/X or vibrance/X — those are
  auto-computed by scripts/wiki_regions.py and will be overwritten).

LEARNING: when the user corrects a proposal (changes the path you picked,
renames a slug, asks for shorter takeaways, etc.), call record_preference
with a one-line rule capturing the correction. Margins remembers it for
next time. Don't record every minor disagreement; record durable rules
about filing conventions, naming patterns, structural rules.

INGESTING: source documents (transcripts, notes, PDFs, Word docs, spreadsheets, decks, emails, EPUBs, etc.) live in folders Margins watches for compilation. By default that's raw/, but the user can set MARGINS_INGEST_ROOTS (comma-separated paths) to point Margins at additional folders. Call list_unprocessed to see files that haven't been compiled. To file one into the wiki, call propose_compile_from_raw with the file's vault-relative path and a summary you generate by reading the file. Files outside the watched roots are still compilable if you pass an explicit path — they just won't appear in list_unprocessed.

TRUST: when the user has placed a source document in raw/ and named it, treat its existence and authorship as given. Don't gate compile on whether you can verify the document's claims from training data — the source page records what the file SAYS, not what you independently know. If the file postdates your knowledge cutoff, that's fine; compile with framing like "Per the document: ..." rather than asserting facts as your own knowledge.

EFFICIENCY: when answering a question that spans multiple pages, fire read_page calls in PARALLEL in a single turn, not sequentially. Sequential reads multiply latency for no benefit. Same for search_vault when querying multiple terms.

TOOL INVENTORY: if you're unsure whether a Margins tool exists or what parameters it accepts, search/list available tools rather than asserting from prior turn state. Optional parameters like propose_compile_from_raw's force=true are easy to overlook; check the schema when a workflow calls for one.

TESTING MODE: when the user explicitly frames an action as testing or pressure-testing (e.g., "fire both calls back-to-back", "this is a test", "validate the reject path"), the propose-then-review pattern can be batched without breaking trust — they have consented to the merged flow. If they provide exact tool parameters and say not to accept a staged proposal, execute that tool call as specified after at most one clarification. Default production review remains on; test batching is allowed only when the user names it as a test.

TOOLS:
- Context: margins_start, recall_preferences, get_vault_context
- Read: search_vault, read_page, list_recent, get_backlinks, list_unprocessed, margins_doctor
- Propose writes: propose_page, propose_edit, append_to, propose_compile_from_raw (supports split mode for multi-section docs)
- Suggest: propose_wikilinks (single-page or scope=glob for A3/B3 vaults with few links; apply=true stages rewritten pages)
- Discover: scan_entity_candidates (find recurring capitalized phrases with no matching slug — A3 cold-start)
- Manage proposals: list_proposals (pattern/limit/sortBy), resolve_proposal (path OR pattern for bulk, dryRun, maxCount), margins_reset_proposals
- Learn: record_preference
- ChatGPT Deep Research: search, fetch`;

export function buildServer(vault, options = {}) {
  const proposals = createProposals(vault);
  const preferences = createPreferences(vault);
  const primer = createPrimer(vault, { proposals, preferences });
  const compile = createCompile(vault, proposals);
  const wikilinks = createWikilinks(vault, { proposals });
  const vaultContext = createVaultContext(vault);
  const telemetry = options.telemetry || { fireAndForget: () => {}, enabled: false };
  const trackToolCall = (toolName) => telemetry.fireAndForget(`/tool/${toolName}`);
  const server = new McpServer(
    {
      name: "margins",
      version: "0.14.2",
      icons: [{ src: MARGINS_ICON_DATA_URI, mimeType: "image/svg+xml" }],
      websiteUrl: "https://marginsmcp.com",
      description:
        "Use your Claude Pro/Max subscription on your Obsidian vault. Reads markdown, " +
        "proposes writes, and compiles raw source files into wiki source pages."
    },
    { instructions: OPERATOR_MANUAL }
  );

  // Wrapper that mirrors server.registerTool but tracks each call via telemetry.
  function register(name, config, handler) {
    return server.registerTool(name, config, async (args, extra) => {
      trackToolCall(name);
      return handler(args, extra);
    });
  }

  register(
    "margins_start",
    {
      description:
        "Conversation-start primer. Always call this once at the start of every vault-relevant conversation. " +
        "The response includes a 'mode' field — read it and follow the 'guidance' field tailored to that mode: " +
        "(1) mode='pile' for unstructured many-file vaults — returns a time-stratified sample of vault files, " +
        "filename patterns, and (importantly) a rawScan with a priorityQueue of raw/ files to compile FIRST via " +
        "propose_compile_from_raw. If priorityQueue is non-empty, your best opening move is to compile those " +
        "files in parallel in a single turn (read_page each to get readable text, then propose_compile_from_raw " +
        "with a structured summary) — the user dropped source documents and wants wiki source pages within ~90 seconds. " +
        "(2) mode='empty' for near-empty vaults — ask what the user wants and offer to scaffold. " +
        "(3) mode='synthesis' for organized linked vaults — returns folder stats, pending proposals, " +
        "uningested files, recent user preferences, and the vault's CLAUDE.md. Ground answers in this structure " +
        "and cite file paths. All modes also return pendingProposals, uningestedRaw, recentPreferences, and vaultManual.",
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () => {
      const summary = await primer.summarize();
      return {
        content: [{ type: "text", text: formatSummary(summary) }],
        structuredContent: summary
      };
    }
  );

  register(
    "recall_preferences",
    {
      description:
        "Read the user's vault-scoped preferences file (.margins/preferences.md). Returns durable rules the user has stated or that you've recorded via record_preference. Call this before any propose_* tool so your proposals follow the user's filing conventions, naming patterns, and prior corrections.",
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () => {
      const body = await preferences.read();
      if (!body) {
        return {
          content: [
            {
              type: "text",
              text:
                "No preferences recorded yet. When the user corrects a proposal, call record_preference to remember the correction. The file lives at " +
                preferences.relPath + " in the vault."
            }
          ],
          structuredContent: { body: "", path: preferences.relPath }
        };
      }
      return {
        content: [{ type: "text", text: body }],
        structuredContent: { body, path: preferences.relPath }
      };
    }
  );

  register(
    "get_vault_context",
    {
      description:
        "Read the vault's wikilinking context: entity slugs (people, organizations, places, tools, projects), active project/decision slugs (priority=active or recently updated), and the in-use semantic tag taxonomy. " +
        "Call this BEFORE propose_compile_from_raw so the page you stage uses real entity slugs in [[wikilinks]] (not invented names) and existing tags (not new variants). " +
        "Region/X and vibrance/X tags are excluded from the response — those are auto-computed by scripts/wiki_regions.py and must not be model-generated. " +
        "Cached on a vault-mtime key; safe to call repeatedly.",
      inputSchema: {
        refresh: z
          .boolean()
          .optional()
          .describe("Force a re-scan even if the vault hasn't changed since the last call. Default false (use cache).")
      },
      annotations: { readOnlyHint: true }
    },
    async ({ refresh }) => {
      const ctx = await vaultContext.get({ refresh: Boolean(refresh) });
      const lines = [
        `Vault context: ${ctx.entities.length} entities, ${ctx.activeProjects.length} active projects, ${ctx.tags.length} tags (${ctx.vaultFiles} wiki files scanned).`,
        "",
        "ENTITIES (use these slugs in [[wikilinks]] and key_links frontmatter):"
      ];
      const slugToTitle = (slug) => String(slug || "").split(/[-_]+/).filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
      for (const e of ctx.entities.slice(0, 60)) {
        lines.push(`  ${e.slug}${e.title && e.title !== slugToTitle(e.slug) ? ` — ${e.title}` : ""}${e.oneLine ? ` — ${e.oneLine.slice(0, 120)}` : ""}`);
      }
      if (ctx.entities.length > 60) lines.push(`  ... and ${ctx.entities.length - 60} more (see structuredContent.entities for full list)`);
      lines.push("", "ACTIVE PROJECTS (link these in relevanceCallout when relevant):");
      for (const p of ctx.activeProjects.slice(0, 30)) {
        lines.push(`  ${p.slug}${p.priority ? ` [${p.priority}]` : ""}${p.oneLine ? ` — ${p.oneLine.slice(0, 120)}` : ""}`);
      }
      if (ctx.activeProjects.length > 30) lines.push(`  ... and ${ctx.activeProjects.length - 30} more`);
      lines.push("", "TAGS IN USE (use these for the tags frontmatter — do NOT invent region/X or vibrance/X):");
      lines.push(`  ${ctx.tags.slice(0, 80).join(", ")}`);
      if (ctx.tags.length > 80) lines.push(`  ... and ${ctx.tags.length - 80} more`);
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: ctx
      };
    }
  );

  register(
    "record_telemetry_consent",
    {
      description:
        "Record the user's choice on anonymous telemetry. Call this exactly once, only when the margins_start response had telemetryConsentNeeded=true AND the user has answered the in-chat opt-in question. Pass enabled=true if they said yes, enabled=false if they said no. The choice persists in ~/.margins/consent.json and applies to all future Margins sessions.",
      inputSchema: {
        enabled: z
          .boolean()
          .describe("True if the user opted in, false if they declined.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async ({ enabled }) => {
      const record = await writeConsent({ enabled });
      // Force the in-memory telemetry object to re-read consent on the next
      // fire-and-forget so the new state takes effect immediately rather than
      // waiting for the 5s cache TTL or a server restart.
      if (telemetry && typeof telemetry.invalidateConsentCache === "function") {
        telemetry.invalidateConsentCache();
      }
      return {
        content: [
          {
            type: "text",
            text: enabled
              ? `Telemetry: on. Recorded at ${record.choseAt}. The user can opt out later by editing ~/.margins/consent.json or setting MARGINS_TELEMETRY=off.`
              : `Telemetry: off. Recorded at ${record.choseAt}. The user can opt in later by editing ~/.margins/consent.json.`
          }
        ],
        structuredContent: record
      };
    }
  );

  register(
    "record_preference",
    {
      description:
        "Append a durable user preference, convention, or correction to the vault's preferences file. Call this when the user corrects a proposal in a way that should apply next time (filing path, naming pattern, summary length, link style, etc.). Do NOT record one-off disagreements or transient feedback. Aim for one-line rules.",
      inputSchema: {
        observation: z
          .string()
          .describe(
            "One-line rule capturing the durable preference. Example: 'Mark Loh meeting notes file under wiki/projects/ not wiki/personal/.'"
          ),
        category: z
          .string()
          .optional()
          .describe(
            "Optional category tag. Examples: 'filing', 'naming', 'voice', 'structure'."
          )
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async ({ observation, category }) => {
      const result = await preferences.append(observation, { category });
      return {
        content: [
          {
            type: "text",
            text: `Recorded preference (${result.date}): ${result.observation}${result.category ? ` [${result.category}]` : ""}. Saved to ${result.path}.`
          }
        ],
        structuredContent: result
      };
    }
  );

  register(
    "search_vault",
    {
      description:
        "Full-text + filename search across the Margins vault. Returns top hits with path and snippet.",
      inputSchema: {
        query: z.string().describe("Search string. Case-insensitive substring."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Max results to return. Default 10.")
      },
      annotations: { readOnlyHint: true }
    },
    async ({ query, limit }) => {
      const hits = await vault.searchVault(query, limit ?? 10);
      return {
        content: [{ type: "text", text: formatSearchHits(hits, query) }],
        structuredContent: { hits }
      };
    }
  );

  register(
    "read_page",
    {
      description: "Read a single vault file by relative path (e.g. 'wiki/career/career.md' or 'raw/report.pdf'). Extracts readable text from supported document formats before returning it.",
      inputSchema: {
        path: z.string().describe("Path relative to the vault root.")
      },
      annotations: { readOnlyHint: true }
    },
    async ({ path: rel }) => {
      const page = await vault.readPage(rel);
      return {
        content: [{ type: "text", text: page.body }],
        structuredContent: {
          path: page.path,
          mtimeMs: page.mtimeMs,
          size: page.size,
          textLength: page.textLength,
          truncated: page.truncated
        }
      };
    }
  );

  register(
    "list_recent",
    {
      description:
        "List the most recently modified vault files. Use this to answer 'what did I just ingest / update'.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe("Default 20.")
      },
      annotations: { readOnlyHint: true }
    },
    async ({ limit }) => {
      const items = await vault.listRecent(limit ?? 20);
      const lines = items.map(
        (i) => `${new Date(i.mtimeMs).toISOString()}  ${i.path}`
      );
      return {
        content: [{ type: "text", text: lines.join("\n") || "(vault empty)" }],
        structuredContent: { items }
      };
    }
  );

  register(
    "get_backlinks",
    {
      description:
        "Find vault pages that link to a target slug or filename. Matches [[wikilinks]] and relative .md links.",
      inputSchema: {
        target: z.string().describe("Slug or filename without extension."),
        limit: z.number().int().min(1).max(100).optional().describe("Default 25.")
      },
      annotations: { readOnlyHint: true }
    },
    async ({ target, limit }) => {
      const hits = await vault.getBacklinks(target, limit ?? 25);
      const lines = hits.map((h) => `- ${h.path} — ${h.snippet}`);
      return {
        content: [
          { type: "text", text: lines.join("\n") || `No backlinks to ${target}.` }
        ],
        structuredContent: { hits }
      };
    }
  );

  register(
    "propose_wikilinks",
    {
      description:
        "Scan vault pages for entity-shaped phrases and propose wikilinks to other vault pages that share the same slug. Two modes:\n" +
        " (1) single-page — pass `path`, get a ranked list of {phrase, wikilink, occurrences} for that one page.\n" +
        " (2) scope — pass `scope` (glob/folder), scan every matching page using one shared slug index (much faster than calling repeatedly), get aggregated suggestions across pages.\n" +
        " With `apply: true` in scope mode, Margins stages one rewritten page per scanned page (a propose_page proposal that replaces every candidate phrase with its wikilink). Apply mode preserves the proposal-review contract — nothing lands until resolve_proposal accepts.\n" +
        " Useful for A3/B3 personas (many files, few wikilinks): scope across a folder finds entity references that already have target pages.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe("Page path for single-page mode, e.g. 'wiki/career/career.md'. Mutually exclusive with scope."),
        scope: z
          .string()
          .optional()
          .describe("Glob for bulk-scope mode, e.g. 'wiki/sources/**' or 'Anatomy/*.md'. Mutually exclusive with path."),
        maxSuggestions: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Cap on suggestions per page. Default 15."),
        maxPages: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Cap on pages scanned in scope mode. Default 50."),
        apply: z
          .boolean()
          .optional()
          .describe("Only meaningful in scope mode. When true, stage a rewritten page per scanned page with all wikilink suggestions applied (one propose_page per page, NOT per phrase). Review/accept via list_proposals + resolve_proposal. Default false (suggest only).")
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async ({ path: rel, scope, maxSuggestions, maxPages, apply }) => {
      const hasPath = typeof rel === "string" && rel.length > 0;
      const hasScope = typeof scope === "string" && scope.length > 0;
      if (hasPath && hasScope) {
        throw new Error("Pass exactly one of path or scope, not both.");
      }
      if (!hasPath && !hasScope) {
        throw new Error("Pass either path (single page) or scope (bulk).");
      }
      if (apply && !hasScope) {
        throw new Error("apply=true only applies in scope mode (requires the scope param).");
      }

      const result = await wikilinks.proposeWikilinks(rel || null, {
        scope, maxSuggestions, maxPages, apply
      });
      if (apply) vaultContext.invalidate();

      if (hasScope) {
        const lines = [
          `Scanned ${result.pagesScanned} page(s) under '${scope}' against ${result.vaultSlugsAvailable} vault slugs.`,
          `Aggregated ${result.aggregatedSuggestions.length} unique link target(s):`,
          ""
        ];
        for (const s of result.aggregatedSuggestions.slice(0, 30)) {
          lines.push(`  ${s.wikilink} → ${s.targetPath}  (${s.totalOccurrences}x across ${s.pageCount} page${s.pageCount === 1 ? "" : "s"})`);
        }
        if (result.aggregatedSuggestions.length > 30) {
          lines.push(`  ... and ${result.aggregatedSuggestions.length - 30} more (full list in structuredContent.aggregatedSuggestions)`);
        }
        if (apply) {
          lines.push("");
          lines.push(`Applied: ${result.applied} page(s) staged as proposals. Review with list_proposals pattern: '${scope}'.`);
        } else if (result.aggregatedSuggestions.length) {
          lines.push("");
          lines.push("Re-run with apply=true to stage rewritten pages (one proposal per page).");
        }
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          structuredContent: result
        };
      }

      const lines = [
        `Scanned ${result.page} against ${result.vaultSlugsAvailable} vault slugs.`,
        `Found ${result.suggestions.length} wikilink candidates:`,
        ""
      ];
      for (const s of result.suggestions) {
        lines.push(`  "${s.phrase}" -> ${s.wikilink}  (${s.targetPath}, ${s.occurrences}x)`);
      }
      if (result.suggestions.length === 0) {
        lines.push("(no candidate phrases matched existing vault slugs)");
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: result
      };
    }
  );

  register(
    "scan_entity_candidates",
    {
      description:
        "Find capitalized phrases that recur across vault pages but have no matching slug — i.e. entities the user keeps mentioning without having a page for them. This is the inverse query of propose_wikilinks: instead of 'where should I add a wikilink to an existing page?', it answers 'what page should exist that doesn't yet?'.\n" +
        "Returns candidates ranked by file-spread × mention-count, with snippets and the list of files where each appears. Read-only — never stages. The companion tool propose_entity_stubs takes the slugs you choose from this list and stages stub entity pages.\n" +
        "Layered filtering: a global English/structural stoplist, an optional domain pack ('med', 'realestate', 'law', 'generic'), and an optional excludeUserRejections list (slugs the user already rejected). Existing slugs are excluded automatically — the shared vault-slug index is the same one propose_wikilinks uses.\n" +
        "Best used right after a fresh import or split-mode compile, when the corpus has many entity references but few entity pages.",
      inputSchema: {
        scope: z
          .string()
          .optional()
          .describe("Glob to limit the walk. Default 'wiki/**'. Pass a folder glob like 'Path/**' to scope to one subject. Supports *, **, ?."),
        minMentions: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("Minimum total mentions across the scope before a candidate qualifies. Default 5. Lower to surface more (noisier); raise for high-confidence only."),
        minFileSpread: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Minimum number of distinct files a candidate must appear in. Default 3. Catches phrases that recur many times in one file (often boilerplate) and treats them as low-signal."),
        domain: z
          .enum(["generic", "med", "realestate", "law"])
          .optional()
          .describe("Domain pack to apply on top of the global stoplist. 'med' drops Step One / Gram Positive / Stage III etc; 'realestate' drops Class A / Phase II / Due Diligence; 'law' drops Section / Article / Chapter; 'generic' (default) applies only the global list."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Cap on candidates returned. Default 50. Total candidate count is in candidatesFound so callers can tell if there are more behind the cap."),
        excludeUserRejections: z
          .array(z.string())
          .optional()
          .describe("Slugs the user has previously declined. Wired by propose_entity_stubs in v0.16+ to read rejection memory from .margins/preferences.md; you can also pass it ad-hoc."),
        minPhraseWords: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("Minimum word count for a candidate to qualify. Default 2 — single-word sentence-start capitals are the dominant noise source on real vaults. Acronyms (AI / MBA / MCP, all-caps 2-6 letters) bypass this filter and surface regardless. Drop to 1 to also see single-word surnames like 'Holmes' or 'Cardozo' (raises recall, raises noise).")
      },
      annotations: { readOnlyHint: true }
    },
    async ({ scope, minMentions, minFileSpread, domain, limit, excludeUserRejections, minPhraseWords }) => {
      const result = await scanEntityCandidates(vault, {
        scope, minMentions, minFileSpread, domain, limit, excludeUserRejections, minPhraseWords
      });
      const lines = [
        `Scanned ${result.filesScanned} files under '${result.scope}' (domain: ${result.domain}).`,
        `Found ${result.candidatesFound} candidate${result.candidatesFound === 1 ? "" : "s"} above thresholds.`,
        `Excluded: ${result.excludedExistingSlugs} existing slugs, ${result.excludedStoplist} stoplisted, ${result.excludedBelowThreshold} below threshold.`,
        ""
      ];
      if (result.candidates.length === 0) {
        lines.push("(no candidates returned — try lowering minMentions / minFileSpread, or scope to a different folder)");
      } else {
        lines.push(`Top ${result.candidates.length}${result.truncated ? ` of ${result.candidatesFound}` : ""}:`);
        for (const c of result.candidates) {
          lines.push(`  ${c.phrase} (slug: ${c.slug}) — ${c.mentionCount}x across ${c.fileCount} file${c.fileCount === 1 ? "" : "s"}`);
          if (c.snippets[0]) lines.push(`      ${c.snippets[0].file}: ${c.snippets[0].snippet}`);
        }
        lines.push("");
        lines.push("Stub the ones worth keeping with propose_entity_stubs (v0.16) — or for now, propose_page individual entity pages.");
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: result
      };
    }
  );

  register(
    "propose_page",
    {
      description:
        "Propose a new page in the vault. Body is the full markdown (frontmatter optional). The page is staged at proposed/<path> until the user accepts it via resolve_proposal. Errors if a page already exists at this path in the vault — use propose_edit or append_to in that case.",
      inputSchema: {
        path: z
          .string()
          .describe("Destination path relative to vault root, e.g. 'wiki/projects/foo.md'."),
        body: z.string().describe("Full markdown body to write.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async ({ path: rel, body }) => {
      const result = await proposals.proposePage(rel, body);
      return {
        content: [
          {
            type: "text",
            text:
              `Staged ${result.proposalPath} → would land at ${result.destinationPath}.` +
              (result.replacedExisting ? " (replaced a prior proposal)" : "") +
              " Run resolve_proposal to accept or reject."
          }
        ],
        structuredContent: result
      };
    }
  );

  register(
    "propose_edit",
    {
      description:
        "Propose an edit to an existing page via exact string replacement. 'before' must appear exactly once in the current file (or in the pending proposal if one exists); add surrounding context if it doesn't. The edit is staged at proposed/<path>.",
      inputSchema: {
        path: z.string().describe("Page path relative to vault root."),
        before: z.string().describe("Exact text to replace. Must be unique in the file."),
        after: z.string().describe("Replacement text. Empty string deletes the match.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async ({ path: rel, before, after }) => {
      const result = await proposals.proposeEdit(rel, before, after);
      return {
        content: [
          {
            type: "text",
            text: `Staged edit to ${result.destinationPath} (read from ${result.readFrom}). Run resolve_proposal to accept.`
          }
        ],
        structuredContent: result
      };
    }
  );

  register(
    "append_to",
    {
      description:
        "Append content to the end of a page. If the page doesn't exist, it's created. If a pending proposal exists for the path, the append stacks on top of it. Result is staged at proposed/<path>. If the user asks for final proposed content, read proposed/<path> after appending instead of inferring.",
      inputSchema: {
        path: z.string().describe("Page path relative to vault root."),
        content: z.string().describe("Content to append. A newline separator is added if needed.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async ({ path: rel, content }) => {
      const result = await proposals.appendTo(rel, content);
      return {
        content: [
          { type: "text", text: `Appended to proposed/${result.destinationPath}.` }
        ],
        structuredContent: result
      };
    }
  );

  register(
    "propose_compile_from_raw",
    {
      description:
        "Compile a supported source file (" + supportedExtensionsList() + ") into a wiki source page proposal staged at proposed/<wiki path>. " +
        "\n\nIMPORTANT — produce a knowledge artifact, not a topic recap. The page you stage is the substrate the user (and future Claude sessions) will retrieve from. Thin pages = thin retrieval. " +
        "\n\nBefore calling, call get_vault_context to know which entity slugs and active project slugs to wikilink, and which semantic tags are already in use. " +
        "\n\nFor a meeting/call/transcript: pick content-specific H2 headings that reflect what was actually discussed (e.g. 'Practice Overview', 'Service Philosophy', 'Succession Status' — NOT 'Summary' / 'Bullets' / 'Takeaways'). Quote verbatim where the exact phrasing matters. Wikilink every entity using slugs from get_vault_context. Include a relevanceCallout naming the active projects/decisions this source bears on. Surface 2-4 concrete applications. " +
        "\n\nFor a synthesis page (pageType='synthesis'): pass the source URLs as `sources`, structure body sections around the argument, include a relevanceCallout. " +
        "\n\nFor a concept page (pageType='concept'): structure as snapshot + context + source log. " +
        "\n\nLegacy callers can still pass `summary` + `summaryBullets` + `takeaways` and skip `sections` — Margins will fall back to the simple template. But the rich path is what produces a knowledge artifact.",
      inputSchema: {
        rawPath: z
          .string()
          .describe("Vault-relative path of the source file. Examples: 'raw/foo.pdf', 'meetings/march-7.md'. Pass list_unprocessed paths directly. Bare filename (e.g. 'foo.pdf') resolves to raw/foo.pdf unless an actual root-level foo.pdf exists and raw/foo.pdf does not."),
        summary: z.string().optional().describe("Rich multi-clause summary (NOT 1-3 sentences). REQUIRED unless split mode is set — in split mode each segment is auto-titled from its heading and no summary is needed. For single-source compile this becomes the frontmatter summary used by retrieval."),
        title: z.string().optional().describe("Title for the page. Defaults to titlecased filename."),
        bucket: z.string().optional().describe("Wiki bucket folder. 'sources', 'projects', 'ideas', 'meetings', 'career'. Pick by topic, not page-type."),
        destination_path: z.string().optional().describe("Override destination path, e.g. 'wiki/career/source-2026-05-13-something.md'."),
        force: z.boolean().optional().describe("Replace an existing source page for this raw file. Without bucket/destination_path override, the existing source page is replaced IN PLACE (same path). With override, the source moves to the new location. Default false."),

        pageType: z.enum(["source", "concept", "synthesis"]).optional().describe("Page shape. 'source' = faithful summary of one raw file (default). 'concept' = durable theme/idea. 'synthesis' = connection-point across multiple sources."),
        tags: z.array(z.string()).optional().describe("Semantic tags (topical, people slugs, firm slugs). DO NOT include region/X or vibrance/X — those are auto-computed by scripts/wiki_regions.py and will be overwritten."),
        keyLinks: z.array(z.string()).optional().describe("Wikilink slugs for the frontmatter key_links field, e.g. ['ellis-rutili', 'centric-wm', 'briefly']. Use slugs from get_vault_context."),
        eventDate: z.string().optional().describe("Date the source event occurred (YYYY-MM-DD). Defaults to today."),
        sourceUrl: z.string().optional().describe("External URL if the source has one (YouTube, blog post, public PDF). Renders as a markdown link in the header block."),
        participants: z.array(z.string()).optional().describe("For meeting/call pages: participant names. Renders as a participants frontmatter list."),
        sources: z.array(z.string()).optional().describe("For synthesis pages: list of evidence URLs. Renders as a sources frontmatter list."),
        headerNote: z.string().optional().describe("Short paragraph under the H1 giving venue/runtime/context (e.g. 'Stanford GSB fireside chat, ~45 min, published 2026-05-04')."),
        sourceCaveat: z.string().optional().describe("Source-quality warning — renders as a `> [!info]+ Source caveat` callout. Use when the source has limitations (e.g. 'Granola summary, no transcript available')."),

        sections: z
          .array(z.object({ heading: z.string(), body: z.string() }))
          .optional()
          .describe("Primary body — array of {heading, body} sections. Pick content-specific H2 headings that fit the source. Body is markdown; may include [[wikilinks]], tables, blockquotes, bold key terms. Quote verbatim where phrasing matters. If you provide sections, the legacy summary/bullets/takeaways template is skipped."),
        relevanceCallout: z
          .object({ body: z.string(), links: z.array(z.string()).optional() })
          .optional()
          .describe("Connor-relevance synthesis. Renders as `> [!claude-note]+ Connor-relevance — Claude synthesis`. Body is markdown. Links is an array of wikilink slugs to active projects/decisions this source bears on."),
        applications: z.array(z.string()).optional().describe("Concrete questions or applications. Renders as `## Personal applications worth tracking`. 2-4 items typical."),
        propagationNotes: z.string().optional().describe("Entity/concept creation decisions made or refused (per operator-manual rule #4). Renders as `## Propagation Notes`."),
        related: z
          .array(z.union([z.string(), z.object({ slug: z.string(), note: z.string().optional() })]))
          .optional()
          .describe("Related wiki pages. Either bare slug strings or {slug, note} objects. Renders as `## Related` with `[[wikilinks]]`."),

        takeaways: z
          .array(z.union([z.string(), z.object({ point: z.string(), evidence: z.string().optional() })]))
          .optional()
          .describe("LEGACY — for the simple template only. If you provide `sections`, this is unused. Either strings or {point, evidence} objects."),
        summaryBullets: z.array(z.string()).optional().describe("LEGACY — for the simple template only. If you provide `sections`, this is unused."),

        quiet: z.boolean().optional().describe("Omit the full staged markdown from the response. The page still lands at proposed/<destinationPath> — set quiet=true when compiling many files in one turn so the response payload stays small. Default false."),

        // ---- Split mode (one raw file → N segment source pages + 1 hub) ----
        split: z.enum(["heading-h1", "heading-h2", "sheet", "auto"]).optional().describe("Split-mode trigger. When set, the raw file is segmented at the chosen boundary and Margins stages one source page per segment plus a hub page that wikilinks them. 'heading-h1' / 'heading-h2' segment by Markdown-style heading level (works for MD/HTML and any extractor that emits H markers like XLSX/PPTX). 'sheet' is alias for h2 splits, ergonomic for spreadsheets. 'auto' picks h2 for spreadsheets and h1 elsewhere. Summary is not required in split mode."),
        maxSegments: z.number().int().min(2).max(200).optional().describe("Cap on segments staged in a single split call. Default 50. Extra headings beyond the cap are noted in the hub but not staged."),
        hubBucket: z.string().optional().describe("Bucket folder for the hub + segment pages when split mode is set. Defaults to bucket if provided, else 'sources'.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async ({
      rawPath, summary, title, bucket, destination_path, force,
      pageType, tags, keyLinks, eventDate, sourceUrl, participants, sources,
      headerNote, sourceCaveat, sections, relevanceCallout, applications,
      propagationNotes, related,
      takeaways, summaryBullets, quiet,
      split, maxSegments, hubBucket
    }) => {
      // Summary is required for single-source compile but not for split mode.
      // The compiler's downstream error if summary is empty is confusing
      // ("compiler returned no source node"); fail fast with a clearer message.
      if (!split && (typeof summary !== "string" || summary.length === 0)) {
        throw new Error(
          "`summary` is required for single-source compile. Provide a rich multi-clause summary, or pass `split` to compile in segments without a summary."
        );
      }
      const result = await compile.proposeCompileFromRaw(rawPath, {
        summary, title, bucket, destination_path, force,
        pageType, tags, keyLinks, eventDate, sourceUrl, participants, sources,
        headerNote, sourceCaveat, sections, relevanceCallout, applications,
        propagationNotes, related,
        takeaways, summaryBullets, quiet,
        split, maxSegments, hubBucket
      });

      // Split-mode response shape differs — render its own summary block.
      if (result.status === "split-staged" || result.status === "already-split") {
        return formatSplitResponse(result);
      }

      if (result.status === "already-filed") {
        return {
          content: [
            {
              type: "text",
              text:
                `${result.rawFile} is already filed at ${result.existingPath}. ` +
                "No proposal staged. Pass force=true to compile again and replace."
            }
          ],
          structuredContent: result
        };
      }
      // Quiet mode: skip the full staged markdown in the response so bulk
      // compile doesn't blast hundreds of KB through the MCP transport.
      const headerLines = quiet
        ? [
            `Compiled ${result.rawFile} → staged at ${result.proposalPath}`,
            `Title: ${result.title}`,
            `Bucket: ${result.bucket}`,
            "",
            "(markdown omitted — quiet=true. Read it from proposed/<destinationPath> if needed.)",
            "",
            "Run resolve_proposal to accept or reject."
          ]
        : [
            `Compiled ${result.rawFile} → staged at ${result.proposalPath}`,
            `Title: ${result.title}`,
            `Bucket: ${result.bucket}`,
            "",
            "--- Staged page ---",
            result.markdown || "(markdown not returned)",
            "--- End staged page ---",
            "",
            "Run resolve_proposal to accept or reject."
          ];
      return {
        content: [{ type: "text", text: headerLines.join("\n") }],
        structuredContent: result
      };
    }
  );

  register(
    "margins_doctor",
    {
      description:
        "Diagnose the vault's health. Returns a structured report of issues: orphan source pages (raw_file points to a missing file), tracker drift (source pages without tracker rows, or tracker rows for missing sources), files with malformed frontmatter, and large raw files. Read-only — never modifies the vault. Use when the user asks 'is anything broken?', 'check my vault', or before major operations.",
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () => {
      const report = await diagnoseVault(vault);
      const { summary, issues } = report;
      const findingLabel = summary.issues_found === 1 ? "finding" : "findings";
      const lines = [
        `Vault health: ${summary.issues_found} ${findingLabel} (${summary.errors} error, ${summary.warnings} warning, ${summary.infos} info).`,
        `Candidates: ${summary.candidates} | filed: ${summary.filed} | pending: ${summary.pending} | source pages: ${summary.source_pages}.`,
        `Ingest roots: ${summary.ingest_roots.join(", ")}.`
      ];
      if (issues.length === 0) {
        lines.push("", "No issues found.");
      } else {
        lines.push("");
        for (const issue of issues) {
          const tag = issue.severity === "error" ? "[error]" : issue.severity === "warn" ? "[warn]" : "[info]";
          lines.push(`${tag} ${issue.kind}: ${issue.message}`);
        }
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: report
      };
    }
  );

  register(
    "list_unprocessed",
    {
      description:
        "List vault files that have not yet been compiled into a wiki source page. Files can live anywhere in the vault (raw/ is conventional but not required) — detection works on raw_file: frontmatter, not folder placement. Use this when the user asks 'what haven't I filed yet?' or before a compile pass. Each item is a vault-relative path you can pass directly to propose_compile_from_raw.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Maximum pending files to return. Default 50.")
      },
      annotations: { readOnlyHint: true }
    },
    async ({ limit }) => {
      const index = await buildVaultIndex(vault);
      const cap = limit ?? 50;
      const shown = index.pending.slice(0, cap);
      const filed = index.candidates.length - index.pending.length;
      const header =
        `Vault: ${index.candidates.length} compilation candidates. ` +
        `${filed} already filed, ${index.pending.length} unprocessed.`;
      const body =
        shown.length === 0
          ? "(nothing pending)"
          : shown.map((n) => `  ${n}`).join("\n") +
            (index.pending.length > shown.length
              ? `\n  ... and ${index.pending.length - shown.length} more`
              : "");
      return {
        content: [{ type: "text", text: `${header}\n${body}` }],
        structuredContent: {
          total_candidates: index.candidates.length,
          filed,
          pending_count: index.pending.length,
          pending: shown
        }
      };
    }
  );

  register(
    "list_proposals",
    {
      description:
        "List pending proposals with optional filtering. Each entry has proposal path, destination path, whether accepting overwrites an existing vault file, size, and (for overwrites under default settings) a small first-diff preview. Use the pattern filter to scope to a folder or file shape when the queue is large.",
      inputSchema: {
        pattern: z
          .string()
          .optional()
          .describe("Glob to filter destinationPath. Supports *, **, ?. Example: 'wiki/sources/*.md' or 'wiki/projects/briefly-**'."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Maximum proposals to return. Response includes totalMatched + truncated flag when results are capped."),
        sortBy: z
          .enum(["path", "age", "size"])
          .optional()
          .describe("Sort order. 'path' (default) is lexical; 'age' is newest mtime first; 'size' is largest first."),
        includeDelta: z
          .boolean()
          .optional()
          .describe("Include per-overwrite first-diff preview. Default true. Set false when scanning a large queue — saves N pairs of file reads.")
      },
      annotations: { readOnlyHint: true }
    },
    async ({ pattern, limit, sortBy, includeDelta }) => {
      const items = await proposals.listProposals({ pattern, limit, sortBy, includeDelta });
      const totalMatched = items.__totalMatched ?? items.length;
      const truncated = Boolean(items.__truncated);
      if (!items.length) {
        const text = pattern
          ? `No proposals matching '${pattern}'.`
          : "No pending proposals.";
        return {
          content: [{ type: "text", text }],
          structuredContent: { items: [], totalMatched: 0, truncated: false }
        };
      }
      const lines = items.map(
        (i) =>
          `- ${i.destinationPath}` +
          (i.willOverwrite ? " (would overwrite existing)" : " (new)") +
          ` — ${i.size} bytes`
      );
      if (truncated) {
        lines.push("", `(showing ${items.length} of ${totalMatched} matched; raise limit to see more)`);
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: {
          items: Array.from(items),
          totalMatched,
          truncated
        }
      };
    }
  );

  register(
    "resolve_proposal",
    {
      description:
        "Accept or reject pending proposals. Two modes: (1) single — pass `path` to apply the action to exactly one proposal; (2) bulk — pass `pattern` (glob) to apply the action to every matching proposal. Exactly one of path/pattern is required. Accept moves proposal to its destination atomically (overwriting any existing file at the destination); reject deletes the proposal without touching the vault. Per-destination lock guarantees concurrent edits on the same path serialize. Use `dryRun: true` with a pattern to preview which proposals would be touched without applying anything.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe("Destination path of a single proposal, with or without the 'proposed/' prefix. Mutually exclusive with pattern."),
        pattern: z
          .string()
          .optional()
          .describe("Glob to match destinationPath of multiple proposals. Supports *, **, ?. Mutually exclusive with path."),
        action: z.enum(["accept", "reject"]).describe("Whether to apply or discard the matched proposal(s)."),
        dryRun: z
          .boolean()
          .optional()
          .describe("Only meaningful with pattern. When true, return the list of paths that WOULD be affected without applying the action."),
        maxCount: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Only meaningful with pattern. Cap the number of proposals processed in a single call.")
      },
      annotations: { readOnlyHint: false, destructiveHint: true }
    },
    async ({ path: rel, pattern, action, dryRun, maxCount }) => {
      const hasPath = typeof rel === "string" && rel.length > 0;
      const hasPattern = typeof pattern === "string" && pattern.length > 0;
      if (hasPath && hasPattern) {
        throw new Error("Pass exactly one of path or pattern, not both.");
      }
      if (!hasPath && !hasPattern) {
        throw new Error("Pass either path (single proposal) or pattern (bulk).");
      }

      if (hasPath) {
        const result = await proposals.resolveProposal(rel, action);
        vaultContext.invalidate();
        return {
          content: [
            { type: "text", text: `${result.destinationPath}: ${result.action}.` }
          ],
          structuredContent: result
        };
      }

      const bulkResult = await proposals.resolveProposalsBulk(pattern, action, { dryRun, maxCount });
      if (!dryRun) vaultContext.invalidate();
      if (bulkResult.dryRun) {
        const overflowNote = bulkResult.wouldOverflow
          ? ` (capped at maxCount=${maxCount}; ${bulkResult.totalMatched} total matched)`
          : "";
        const lines = [
          `Would ${action} ${bulkResult.matched} proposal${bulkResult.matched === 1 ? "" : "s"}${overflowNote}:`,
          ...bulkResult.paths.map((p) => `  ${p}`),
          "",
          `Re-run without dryRun to apply.`
        ];
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          structuredContent: bulkResult
        };
      }
      const summary = `${action === "accept" ? "Accepted" : "Rejected"} ${bulkResult.succeeded}/${bulkResult.processed} proposal${bulkResult.processed === 1 ? "" : "s"} matching '${pattern}'.`;
      const failureLines = bulkResult.results
        .filter((r) => !r.ok)
        .map((r) => `  ✗ ${r.path}: ${r.error}`);
      const text = failureLines.length
        ? [summary, "Failures:", ...failureLines].join("\n")
        : summary;
      return {
        content: [{ type: "text", text }],
        structuredContent: bulkResult
      };
    }
  );

  register(
    "margins_reset_proposals",
    {
      description:
        "Clear all pending proposals from proposed/. Use when proposals have accumulated from failed Claude sessions, or when the user wants a clean slate. Returns the number of files that would be deleted. Requires confirm=true to actually delete — without confirm, returns a dry-run list. Vault files are never touched; only files under proposed/.",
      inputSchema: {
        confirm: z
          .boolean()
          .optional()
          .describe(
            "Pass true to actually delete the pending proposals. Default false returns a dry-run preview."
          )
      },
      annotations: { readOnlyHint: false, destructiveHint: true }
    },
    async ({ confirm }) => {
      const items = await proposals.listProposals();
      if (items.length === 0) {
        return {
          content: [{ type: "text", text: "No pending proposals to reset." }],
          structuredContent: { dryRun: !confirm, count: 0, paths: [] }
        };
      }
      const paths = items.map((i) => i.proposalPath);
      if (!confirm) {
        const lines = [
          `Dry run: ${items.length} pending proposal${items.length === 1 ? "" : "s"} would be deleted.`,
          ...paths.map((p) => `  ${p}`),
          "",
          "Re-run margins_reset_proposals with confirm=true to actually delete them."
        ];
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          structuredContent: { dryRun: true, count: items.length, paths }
        };
      }
      const deleted = await proposals.resetAllProposals();
      return {
        content: [
          { type: "text", text: `Deleted ${deleted.length} pending proposal${deleted.length === 1 ? "" : "s"}.` }
        ],
        structuredContent: { dryRun: false, count: deleted.length, paths: deleted }
      };
    }
  );

  register(
    "search",
    {
      description:
        "ChatGPT Deep Research search. Returns a list of {id, title, url} where id is the vault path. Pair with fetch.",
      inputSchema: { query: z.string() },
      annotations: { readOnlyHint: true }
    },
    async ({ query }) => {
      const hits = await vault.searchVault(query, 20);
      const results = hits.map((h) => ({
        id: h.path,
        title: titleFromPath(h.path),
        url: `margins://${h.path}`
      }));
      return {
        content: [{ type: "text", text: JSON.stringify({ results }) }],
        structuredContent: { results }
      };
    }
  );

  register(
    "fetch",
    {
      description:
        "ChatGPT Deep Research fetch. Returns {id, title, text, url, metadata} for the given vault path.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true }
    },
    async ({ id }) => {
      const page = await vault.readPage(id);
      const payload = {
        id: page.path,
        title: titleFromPath(page.path),
        text: page.body,
        url: `margins://${page.path}`,
        metadata: {
          mtimeMs: page.mtimeMs,
          size: page.size,
          textLength: page.textLength,
          truncated: page.truncated
        }
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload
      };
    }
  );

  return server;
}

function formatSplitResponse(result) {
  if (result.status === "already-split") {
    return {
      content: [
        {
          type: "text",
          text:
            `${result.rawFile} is already split — hub at ${result.hubPath} (${result.hubLocation}). ` +
            "Pass force=true to re-stage every segment + hub."
        }
      ],
      structuredContent: result
    };
  }
  const overflowNote = result.overflow
    ? ` (capped at maxSegments; ${result.overflowDropped} additional headings dropped)`
    : "";
  const lines = [
    `Split ${result.rawFile} into ${result.segmentsCount} segments${overflowNote}.`,
    `Hub staged: ${result.hubProposalPath} → would land at ${result.hubPath}`,
    `Bucket: ${result.bucket}, splitOn: ${result.splitOn}`,
    "",
    "Segments:"
  ];
  for (const seg of result.segments) {
    lines.push(`  ${seg.proposalPath} — ${seg.heading}`);
  }
  lines.push("", "Review with `list_proposals pattern: 'wiki/" + result.bucket + "/source-*'` then accept all via `resolve_proposal pattern + action: accept`.");
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: result
  };
}

function formatSearchHits(hits, query) {
  if (!hits.length) return `No matches for "${query}".`;
  return hits.map((h) => `${h.path}\n  ${h.snippet}`).join("\n\n");
}

function titleFromPath(rel) {
  const name = rel.split("/").pop() || rel;
  return name.replace(/\.md$/i, "");
}

export async function runStdio({ vaultRoot } = {}) {
  const root = vaultRoot || process.env.MARGINS_VAULT || process.cwd();
  const { roots, skipDirs, source } = await detectIndexRoots(
    root,
    process.env.MARGINS_INDEX_ROOTS
  );
  const vault = createVault(root, { indexRoots: roots, skipDirs });
  const telemetry = await loadTelemetry();
  const server = buildServer(vault, { telemetry });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `margins-mcp: serving vault at ${vault.root} ` +
      `(index roots: ${roots.join(", ")}, detected via ${source}, ` +
      `telemetry: ${telemetry.enabled ? (selfTagEnabled() ? "on/self-tagged" : "on") : "off"})`
  );
}
