# margins-mcp

Read-only MCP connector that exposes a Margins vault to Claude or ChatGPT.

The chat surface stays in the host app (Claude Desktop / claude.ai / ChatGPT) so the user's existing subscription covers inference. This connector only serves vault data.

## Install (Claude Code / Claude Desktop, stdio)

```sh
claude mcp add margins -- node /absolute/path/to/connor_brain2/margins/mcp/bin/margins-mcp.js \
  --env MARGINS_VAULT=/absolute/path/to/connor_brain2
```

Or wire it manually in `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "margins": {
      "command": "node",
      "args": ["/absolute/path/to/connor_brain2/margins/mcp/bin/margins-mcp.js"],
      "env": { "MARGINS_VAULT": "/absolute/path/to/connor_brain2" }
    }
  }
}
```

## Tools

| Tool | Purpose |
|------|---------|
| `search_vault` | Full-text + filename search across the vault. |
| `read_page` | Read one page by relative path. |
| `list_recent` | Most recently modified pages. |
| `get_backlinks` | Pages that wikilink to a target slug. |
| `search` / `fetch` | ChatGPT Deep Research compatibility pair. |

## Run + test

```sh
cd margins/mcp
npm install
npm test
MARGINS_VAULT=/absolute/path/to/connor_brain2 npm start
```

## What's next

- HTTP / Streamable transport for claude.ai and ChatGPT remote connectors (OAuth 2.1 DCR required for ChatGPT — see `project_margins_mcp_divergence_facts`).
- Write tools (ingest, propose-edit) once the read path is dogfooded.
