# Margins

Margins is a local-first raw-source-to-wiki compiler for LLMs.

It turns:

```text
raw_sources/
```

into:

```text
wiki/
operator-manual.md
query-cookbook.md
commands/
agents/
.margins/
```

The goal is not file organization. The goal is an LLM-operable wiki: source nodes, concept nodes, entity nodes, synthesis nodes, citations, commands, agents, and an edit log that Claude or ChatGPT can read from and write back into through MCP.

## Run the local app

```bash
npm run dev
```

Open `http://localhost:5173`.

The browser app has two compile paths:

- `Local compile` uses only local heuristics. It proves the folder -> wiki -> operating layer pipeline.
- `Extract PDF text` uses PDF.js in the browser to turn readable PDFs into source text.
- `Copy LLM ingest prompt` creates a Claude/ChatGPT handoff prompt. Use this after extraction; failed PDFs are listed as attachments.
- `LLM Review` parses Claude/ChatGPT output returned as `margins-file` fenced blocks and lets you preview it before accepting it as the current wiki.
- `Select workspace folder` chooses a local vault folder, and `Write to workspace` writes the accepted wiki plus original raw sources directly into that folder using the browser File System Access API.

## Compile the sample vault

```bash
npm run compile
```

This writes a generated vault to `sample/output`.

## Compile your own folder

```bash
npm run compile:custom -- /path/to/raw_sources /path/to/output
```

## Current scope

- Local-first proof of concept.
- Markdown/text files are fully supported.
- PDFs with selectable text can be extracted locally in the browser.
- No hosted storage.
- No Margins-owned chat surface.
- Write-back is proposal-first, never silent.
