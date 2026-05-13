# margins-mcp

An MCP connector that exposes a Margins vault to Claude or ChatGPT.

The chat surface stays in the host app (Claude Desktop / claude.ai / ChatGPT) so the user's existing subscription covers inference. This connector serves vault data and stages proposed writes.

## Install (Claude Code / Claude Desktop, stdio)

```sh
claude mcp add margins -- node /absolute/path/to/Margins/mcp/bin/margins-mcp.js \
  --env MARGINS_VAULT=/absolute/path/to/your/vault
```

Or wire it manually in `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "margins": {
      "command": "node",
      "args": ["/absolute/path/to/Margins/mcp/bin/margins-mcp.js"],
      "env": { "MARGINS_VAULT": "/absolute/path/to/your/vault" }
    }
  }
}
```

## Tools

### Read

| Tool | Purpose |
|------|---------|
| `search_vault` | Full-text + filename search across the vault. |
| `read_page` | Read one page by relative path. |
| `list_recent` | Most recently modified pages. |
| `get_backlinks` | Pages that wikilink to a target slug. |
| `search` / `fetch` | ChatGPT Deep Research compatibility pair. |

### Write (proposal-based — nothing lands until accepted)

| Tool | Purpose |
|------|---------|
| `propose_page` | Stage a new page at `proposed/<path>`. Errors if the destination already exists. |
| `propose_edit` | Stage a string-replacement edit. `before` must appear exactly once in the current file. |
| `append_to` | Stage an append. Creates the page if it doesn't exist. Stacks on top of any pending proposal. |
| `list_proposals` | List pending proposals and whether each would overwrite an existing vault file. |
| `resolve_proposal` | `action: "accept"` moves `proposed/<path>` to `<path>` in the vault. `action: "reject"` deletes the proposal. |

### How the proposal flow works

Every write tool stages to `proposed/<path>` inside your vault. Nothing touches the live tree until you (or an MCP client acting on your behalf) call `resolve_proposal` with `action: "accept"`. You can also manually inspect the staged content (`ls proposed/`) and accept by moving files yourself.

This means:
- Claude can never silently overwrite your notes.
- You can audit what was proposed and when.
- Sequential edits stack: a second `propose_edit` on the same path reads from the pending proposal, not the vault.

## Run + test

```sh
cd mcp
npm install
npm test
MARGINS_VAULT=/absolute/path/to/your/vault npm start
```

## What's next

- `npx @margins/mcp install` — interactive setup that detects Claude Desktop / Claude Code, writes the config, and runs a verification probe.
- A `margins_start` primer tool that returns vault context + suggested first queries.
- `MARGINS_INDEX_ROOTS` env var to limit search to `wiki/` by default.
- HTTP / Streamable transport for claude.ai web and ChatGPT custom connectors (OAuth 2.1 DCR required for the latter).
