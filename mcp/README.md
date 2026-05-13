# margins-mcp

**Use your Claude Pro/Max subscription on your Obsidian vault.** No API key. No per-token costs. No embedding pipelines. Claude reads your notes and proposes updates; your subscription pays for inference; your files stay on your disk.

[30-second demo placeholder — record after v0.3 ships]

## Install

```sh
npx @margins/mcp install --vault /path/to/your/vault
```

That's it. The installer detects Claude Desktop and Claude Code, writes the right config files, and runs a verification probe. Restart Claude Desktop (Cmd-Q on macOS, not just close), or in Claude Code run `/mcp` to see Margins listed.

Don't have an Obsidian vault yet? Scaffold a Margins-shaped one:

```sh
npx @margins/mcp install --starter-vault ~/notes
```

### Manual install

If you'd rather edit config yourself, add this to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS path; see [Anthropic docs](https://modelcontextprotocol.io/quickstart/user) for Windows/Linux):

```json
{
  "mcpServers": {
    "margins": {
      "command": "node",
      "args": ["/absolute/path/to/margins-mcp/bin/margins-mcp.js"],
      "env": { "MARGINS_VAULT": "/absolute/path/to/your/vault" }
    }
  }
}
```

## Try it

In a new Claude conversation, ask:

> Use margins to give me a summary of my recent notes.

Or:

> What pages support the claim that my project deadline is May 30th? Use margins to find them.

Or:

> I just dropped a transcript into `raw/`. Compile it into a structured source page in my wiki.

The model can read your vault, propose new pages, propose edits to existing ones, and pull raw sources into structured wiki pages. Every write stages to `proposed/` first; nothing lands without you accepting.

## Tools

### Read

| Tool | Purpose |
|------|---------|
| `margins_start` | Primer: vault stats + suggested queries. Call this first in a new conversation. |
| `search_vault` | Full-text + filename search across the vault. |
| `read_page` | Read one page by relative path. |
| `list_recent` | Most recently modified pages. |
| `get_backlinks` | Pages that wikilink to a target slug. |
| `search` / `fetch` | ChatGPT Deep Research compatibility pair. |

### Propose writes (staged — nothing lands until accepted)

| Tool | Purpose |
|------|---------|
| `propose_page` | Stage a new page at `proposed/<path>`. |
| `propose_edit` | Stage a string-replacement edit. `before` must appear exactly once. |
| `append_to` | Stage an append. Creates the page if missing; stacks on pending proposals. |
| `propose_compile_from_raw` | Turn a raw transcript/note in `raw/` into a structured source page. |
| `list_proposals` | List pending proposals + overwrite-risk flag per entry. |
| `resolve_proposal` | `action: "accept"` lands the proposal; `action: "reject"` discards it. |

### How the proposal flow works

Every write tool stages to `proposed/<path>` inside your vault. Nothing touches the live tree until you (or an MCP client acting on your behalf) call `resolve_proposal` with `action: "accept"`. You can also inspect staged content (`ls proposed/`) and accept by moving files yourself.

Sequential edits stack: a second `propose_edit` on the same path reads from the pending proposal, not the vault.

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `MARGINS_VAULT` | (required) | Absolute path to your Obsidian vault or Markdown folder. |
| `MARGINS_INDEX_ROOTS` | auto-detected | Comma-separated subfolders to index. Auto-detection: `.obsidian/` present → index root; `wiki/` present → index `wiki/` only; neither → index root. |
| `MARGINS_TELEMETRY` | (consent file) | Override telemetry: `on` or `off`. Default uses the consent decision made during install. |

## What Margins is NOT

To keep scope crisp:

- **Not an inference layer.** Your Claude subscription pays for that. Margins makes zero LLM calls.
- **Not a web app.** The chat surface lives in Claude Desktop / Claude Code / claude.ai. Margins is plumbing.
- **Not a cloud sync.** Local-first. Your files stay on your disk.
- **Not a CRM integration.** Different product.
- **Not API-key-based.** Subscription-passthrough is the whole point.

## Privacy

- Vault content never leaves your machine. Margins is a Node process that reads/writes files locally and exposes structured tools over stdio.
- Anonymous telemetry (opt-in at install time) reports tool-call counts to help me prioritize what to build next. Sample event payload: `GET https://margins.goatcounter.com/count?p=/tool/search_vault`. No vault content, no file paths, no user identifier beyond the standard 24-hour rolling session token GoatCounter assigns. Disable per-session with `MARGINS_TELEMETRY=off`. Decision stored at `~/.margins/consent.json`.

## Develop

```sh
git clone https://github.com/cflorczyk9/Margins.git
cd Margins/mcp
npm install
npm test
MARGINS_VAULT=/path/to/test/vault npm start
```

The compiler (`src/compiler/`) is vendored from the parent `margins/src/` tree so `npm publish` ships a self-contained package. Re-vendor with `scripts/vendor-compiler.sh` if you change upstream sources.

## Roadmap

- v0.4: `get_citations` (semantic embedding search, opt-in dep).
- v0.4: PDF/DOCX support for `propose_compile_from_raw`.
- v0.5: HTTP / Streamable transport for claude.ai web and ChatGPT custom connectors.
- v0.5+: Obsidian community plugin alongside MCP, if signal supports it.

## License

MIT
