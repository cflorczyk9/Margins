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
- Context: margins_start, recall_preferences
- Read: search_vault, read_page, list_recent, get_backlinks, list_unprocessed, margins_doctor
- Propose writes: propose_page, propose_edit, append_to, propose_compile_from_raw
- Suggest: propose_wikilinks (for A3/B3 vaults with few links)
- Manage proposals: list_proposals, resolve_proposal, margins_reset_proposals
- Learn: record_preference
- ChatGPT Deep Research: search, fetch`;

export function buildServer(vault, options = {}) {
  const proposals = createProposals(vault);
  const preferences = createPreferences(vault);
  const primer = createPrimer(vault, { proposals, preferences });
  const compile = createCompile(vault, proposals);
  const wikilinks = createWikilinks(vault);
  const telemetry = options.telemetry || { fireAndForget: () => {}, enabled: false };
  const trackToolCall = (toolName) => telemetry.fireAndForget(`/tool/${toolName}`);
  const server = new McpServer(
    {
      name: "margins",
      version: "0.13.0",
      icons: [{ src: MARGINS_ICON_DATA_URI, mimeType: "image/svg+xml" }],
      websiteUrl: "https://margins.app",
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
        "Scan a page for entity-shaped phrases and propose wikilinks to other vault pages that share the same slug. Returns a ranked list of {phrase, wikilink, targetPath, occurrences}. Especially useful for A3/B3 personas (many files, few wikilinks). The model then chooses which suggestions to apply via propose_edit (one edit per phrase).",
      inputSchema: {
        path: z
          .string()
          .describe("Page path relative to vault root, e.g. 'wiki/career/career.md'."),
        maxSuggestions: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Cap on suggestions returned. Default 15.")
      },
      annotations: { readOnlyHint: true }
    },
    async ({ path: rel, maxSuggestions }) => {
      const result = await wikilinks.proposeWikilinks(rel, { maxSuggestions });
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
        "Compile a supported source file from anywhere in the vault into a structured wiki source page proposal. Supports: " +
        `${supportedExtensionsList()}. ` +
        "The file can live at the vault root, in raw/, or in any custom subfolder — pass its vault-relative path. You (the model) provide the review metadata: a summary, optional bucket, optional takeaways. Margins extracts readable text, runs its compiler, and stages the result at proposed/<wiki path>. Use this whenever the user wants a document filed into the wiki where it can link to other notes.",
      inputSchema: {
        rawPath: z
          .string()
          .describe("Vault-relative path of the source file. Examples: 'raw/foo.pdf', 'meetings/march-7.md', 'lawyer/contract.pdf'. Pass list_unprocessed paths directly. For back-compat, a bare filename (e.g. 'foo.pdf') resolves to raw/foo.pdf unless an actual root-level foo.pdf exists and raw/foo.pdf does not."),
        summary: z.string().describe("1-3 sentence summary of what this source is about."),
        title: z.string().optional().describe("Title for the source page. Defaults to titlecased filename."),
        bucket: z.string().optional().describe("Wiki bucket. Default 'sources'. Try 'projects', 'career', 'ideas', etc."),
        destination_path: z
          .string()
          .optional()
          .describe("Override destination, e.g. 'wiki/career/source-2026-05-13-something.md'."),
        takeaways: z
          .array(
            z.union([
              z.string(),
              z.object({ point: z.string(), evidence: z.string().optional() })
            ])
          )
          .optional()
          .describe("Key takeaways. Either strings or {point, evidence} objects."),
        summaryBullets: z.array(z.string()).optional().describe("Short summary bullets."),
        force: z
          .boolean()
          .optional()
          .describe(
            "Replace an existing source page for this raw file. Use when the user wants to refresh a source after the raw file changed, redo the summary, or reframe takeaways. Without bucket/destination_path override, the existing source page is replaced IN PLACE (same path). With override, the source moves to the new location. Default false."
          )
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async ({ rawPath, summary, title, bucket, destination_path, takeaways, summaryBullets, force }) => {
      const result = await compile.proposeCompileFromRaw(rawPath, {
        summary,
        title,
        bucket,
        destination_path,
        takeaways,
        summaryBullets,
        force
      });
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
      const lines = [
        `Compiled ${result.rawFile} → staged at ${result.proposalPath}`,
        `Title: ${result.title}`,
        `Bucket: ${result.bucket}`,
        result.summary ? `Summary: ${result.summary}` : null,
        result.entitiesExtracted && result.entitiesExtracted.length
          ? `Entities extracted: ${result.entitiesExtracted.join(", ")}`
          : null,
        "",
        "Run resolve_proposal to accept or reject."
      ].filter(Boolean);
      return {
        content: [{ type: "text", text: lines.join("\n") }],
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
        "List every pending proposal. Each entry has its proposal path, its destination path, and whether accepting would overwrite an existing vault file.",
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () => {
      const items = await proposals.listProposals();
      if (!items.length) {
        return {
          content: [{ type: "text", text: "No pending proposals." }],
          structuredContent: { items: [] }
        };
      }
      const lines = items.map(
        (i) =>
          `- ${i.destinationPath}` +
          (i.willOverwrite ? " (would overwrite existing)" : " (new)") +
          ` — ${i.size} bytes`
      );
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: { items }
      };
    }
  );

  register(
    "resolve_proposal",
    {
      description:
        "Accept or reject a pending proposal. Accept moves the proposal from proposed/<path> to <path> (overwriting any existing vault file at the destination). Reject deletes the proposal without touching the vault.",
      inputSchema: {
        path: z
          .string()
          .describe("Destination path of the proposal, with or without the 'proposed/' prefix."),
        action: z.enum(["accept", "reject"]).describe("Whether to apply or discard.")
      },
      annotations: { readOnlyHint: false, destructiveHint: true }
    },
    async ({ path: rel, action }) => {
      const result = await proposals.resolveProposal(rel, action);
      return {
        content: [
          { type: "text", text: `${result.destinationPath}: ${result.action}.` }
        ],
        structuredContent: result
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
