import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createVault } from "./vault.js";
import { createProposals } from "./proposals.js";
import { detectIndexRoots } from "./index-roots.js";
import { createPrimer, formatSummary } from "./primer.js";
import { createCompile } from "./compile.js";

export function buildServer(vault) {
  const proposals = createProposals(vault);
  const primer = createPrimer(vault);
  const compile = createCompile(vault, proposals);
  const server = new McpServer(
    { name: "margins", version: "0.2.0" },
    {
      instructions:
        "Margins vault tools. START HERE: call margins_start to see what's in the user's vault and get suggested queries. READ: search_vault, read_page, list_recent, get_backlinks. WRITE: writes are proposals — propose_page, propose_edit, and append_to all stage to proposed/<path>. The user (or an MCP client) calls list_proposals to see what's pending and resolve_proposal to accept or reject. Nothing lands in the vault until accepted. ChatGPT Deep Research clients should call search + fetch."
    }
  );

  server.registerTool(
    "margins_start",
    {
      description:
        "Primer for a new conversation. Returns vault stats (file count, top folders) and 2-3 suggested queries to try. Call this first if you don't know what's in the user's vault.",
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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
  const server = buildServer(vault);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `margins-mcp: serving vault at ${vault.root} ` +
      `(index roots: ${roots.join(", ")}, detected via ${source})`
  );
}
