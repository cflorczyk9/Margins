# margins-mcp

**Use your Claude Pro/Max subscription on your Obsidian vault.** No API key. No per-token costs. No embedding pipelines. Claude reads your notes and proposes updates; your subscription pays for inference; your files stay on your disk.

`margins-mcp` is a small Node program that sits between Claude (Desktop or Code) and your Obsidian vault. When you chat with Claude, it reads your notes through `margins-mcp`. Your files stay local, Claude does the thinking, your existing subscription pays for it.

## Which Margins are you?

Margins works for six common starting points. `margins_start` auto-detects your state on the first call, so you don't have to classify yourself — but knowing which row you're on helps set expectations.

| You... | Persona | First conversation |
|---|---|---|
| Obsidian, vault organized with wikilinks | **A1** | Q&A on your notes. `margins_start` then ask anything. |
| Obsidian, vault is empty or new | **A2** | Ask Claude to scaffold daily-note + meeting templates. |
| Obsidian, many files but few wikilinks | **A3** | Run `propose_wikilinks` on a page to surface connections you missed. |
| No Obsidian, organized markdown | **B1** | Same as A1. Install Obsidian for the proposal-review UX. |
| No Obsidian, empty | **B2** | Use `--starter-vault ~/Margins` to scaffold one. |
| No Obsidian, messy folder | **B3** | Run `propose_wikilinks` on your busiest page. Install Obsidian to review proposals visually. |

## Requirements

- [Node.js 18 or newer](https://nodejs.org)
- An Obsidian vault, or any folder with notes, PDFs, Office/OpenDocument files, email exports, EPUBs, or plain text
- A Claude subscription: Pro ($20/mo), Max, or Claude Code

## Install

Two commands:

```sh
npm install -g margins-mcp
margins-mcp install
```

The installer prompts for your vault path, detects Claude Desktop and Claude Code, writes the right config files, scaffolds `raw/` + `proposed/` + `.margins/` inside your vault if missing, and runs a verification probe. Restart Claude Desktop (`Cmd-Q` on macOS, not just close the window), or in Claude Code run `/mcp` to see Margins listed.

### Don't have a vault yet?

Scaffold a Margins-shaped one:

```sh
margins-mcp install --starter-vault ~/notes
```

### Finding your Obsidian vault path

If you already use Obsidian and don't know your vault's absolute path:

- **In Obsidian:** right-click the vault name in the file tree → "Reveal in Finder" (macOS) or "Show in Explorer" (Windows). The path is in the title bar.
- **macOS common paths:** `~/Documents/<VaultName>`, or `~/Library/CloudStorage/iCloudDrive/Obsidian/<VaultName>` if iCloud-synced.
- **Linux common paths:** `~/Documents/<VaultName>`, or `~/.local/share/Obsidian/<VaultName>`.
- **Windows common paths:** `%USERPROFILE%\Documents\<VaultName>`.

Pass it to the installer via `--vault /absolute/path` or answer the prompt.

### Try-without-installing

```sh
npx margins-mcp install --vault /path/to/vault
```

You'll see a warning that npm may garbage-collect the npx cache and your configs would break weeks later. For real use, prefer `npm install -g` above. The npx path is fine for kicking the tires.

### Manual install

If you'd rather edit config yourself, add this to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS; see [Anthropic docs](https://modelcontextprotocol.io/quickstart/user) for Windows/Linux paths):

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

> I just dropped a spreadsheet into `raw/`. Compile it into a structured source page in my wiki.

The model can read your vault, propose new pages, propose edits to existing ones, and pull raw sources into structured wiki pages. `propose_compile_from_raw` accepts Markdown/plain text, PDFs, Word docs, spreadsheets, decks, email exports, EPUBs, OpenDocument files, RTF, HTML, CSV/TSV, JSON, YAML, and common text-ish formats. Every write stages to `proposed/` first; nothing lands without you accepting.

## Tools

### Context (call once per conversation)

| Tool | Purpose |
|------|---------|
| `margins_start` | Vault stats + pending proposals + uningested raw files + recent preferences + the vault's `CLAUDE.md` if present. Claude's grounding for the whole conversation. |
| `recall_preferences` | Read durable user preferences from `.margins/preferences.md` (filing conventions, naming patterns, prior corrections). Claude calls this before any propose. |

### Read

| Tool | Purpose |
|------|---------|
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
| `propose_compile_from_raw` | Turn a raw transcript, note, PDF, Word doc, spreadsheet, deck, email, EPUB, or other supported document in `raw/` into a structured source page. |
| `list_proposals` | List pending proposals + overwrite-risk flag per entry. |
| `resolve_proposal` | `action: "accept"` lands the proposal; `action: "reject"` discards it. |

### Suggest (for A3 / B3 — vaults with many files but few links)

| Tool | Purpose |
|------|---------|
| `propose_wikilinks` | Scan a page for entity-shaped phrases and propose wikilinks to other vault pages that share the same slug. The model then chains `propose_edit` calls to apply the ones it likes. |

### Learn

| Tool | Purpose |
|------|---------|
| `record_preference` | Append a durable rule to `.margins/preferences.md`. Claude calls this when the user corrects a proposal in a way that should apply next time (filing path, naming, summary length, etc.). |

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
cd Margins
npm install
npm test
MARGINS_VAULT=/path/to/test/vault npm start
```

The compiler (`src/compiler/`) was originally vendored from an earlier Margins web app. The web app and its landing page live on the `legacy-webapp` branch in this repo. Re-vendor with `scripts/vendor-compiler.sh` if you ever need to pull updates back from there.

## How Margins gets smarter over time

Two things compound:

1. **Your vault's `CLAUDE.md`** is auto-loaded by `margins_start`. Drop vault-specific rules in there — filing conventions, voice, naming patterns — and Claude obeys them in every conversation. No copy-paste.
2. **`.margins/preferences.md`** is a Margins-maintained file inside your vault. When you correct Claude ("no, that should be in projects, not personal"), Claude calls `record_preference` to remember the rule. Next conversation it reads them via `recall_preferences` before proposing writes. The file is plain Markdown — you can audit it, hand-edit it, delete sections that no longer apply.

Both files live in the vault, so they travel with it. Switch machines, switch hosts (Claude Desktop → Claude Code → ChatGPT once that lands), and your conventions follow.

## Roadmap

- v0.6: web onboarding at marginsmcp.com — pick a folder via File System Access, scaffold a vault, get the install command. Closes B2/B3 personas without requiring CLI fluency.
- v0.6: `get_citations` (semantic embedding search, opt-in dep).
- v0.6: OCR/image, legacy Office binary, and audio/video ingestion for `propose_compile_from_raw`.
- v0.7: HTTP / Streamable transport for claude.ai web and ChatGPT custom connectors.
- v0.7+: Obsidian community plugin alongside MCP, if signal supports it.
- v0.8+: file watcher / auto-scaffold on drop into `raw/`.

## License

MIT
