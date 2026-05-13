import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createVault } from "./vault.js";
import { createProposals } from "./proposals.js";
import { detectIndexRoots } from "./index-roots.js";
import { createPrimer, formatSummary } from "./primer.js";
import { createCompile } from "./compile.js";
import { loadTelemetry } from "./telemetry.js";
import { createPreferences } from "./preferences.js";
import { createWikilinks } from "./wikilinks.js";

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

INGESTING: raw transcripts and notes live in raw/<filename>. To file one
into the vault, call propose_compile_from_raw with a summary you generate
by reading the file.

TOOLS:
- Context: margins_start, recall_preferences
- Read: search_vault, read_page, list_recent, get_backlinks
- Propose writes: propose_page, propose_edit, append_to, propose_compile_from_raw
- Suggest: propose_wikilinks (for A3/B3 vaults with few links)
- Manage proposals: list_proposals, resolve_proposal
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
    { name: "margins", version: "0.5.0" },
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
        "Conversation-start primer. Returns vault stats (file count, top folders), pending proposals, uningested files in raw/, the user's most recent preferences, and the vault's CLAUDE.md if present. Call this once at the start of every vault-relevant conversation so you ground your answers in the actual vault state.",
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
      description: "Read a single vault page by relative path (e.g. 'wiki/career/career.md').",
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
          size: page.size
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
        "Append content to the end of a page. If the page doesn't exist, it's created. If a pending proposal exists for the path, the append stacks on top of it. Result is staged at proposed/<path>.",
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
        "Compile a text file under raw/ into a structured source page proposal. You (the model) provide the review metadata: a summary, optional bucket, optional takeaways. Margins runs its compiler and stages the result at proposed/<wiki path>. Use this when the user has dropped a raw transcript / notes file into raw/ and wants it filed into the wiki. v0.3: text only (.md, .markdown, .txt). PDF/DOCX support deferred to v0.4.",
      inputSchema: {
        rawPath: z
          .string()
          .describe("Path of the raw file. Either 'raw/foo.md' or just 'foo.md' (auto-prefixed)."),
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
        summaryBullets: z.array(z.string()).optional().describe("Short summary bullets.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async ({ rawPath, summary, title, bucket, destination_path, takeaways, summaryBullets }) => {
      const result = await compile.proposeCompileFromRaw(rawPath, {
        summary,
        title,
        bucket,
        destination_path,
        takeaways,
        summaryBullets
      });
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
        metadata: { mtimeMs: page.mtimeMs, size: page.size }
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
      `telemetry: ${telemetry.enabled ? "on" : "off"})`
  );
}
