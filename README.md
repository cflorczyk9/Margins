# Margins

Margins is a local-first raw-source-to-wiki compiler for LLMs.

It turns:

```text
raw_sources/
```

into:

```text
wiki/
  .margins/
operator-manual.md
query-cookbook.md
commands/
agents/
```

The goal is not file organization. The goal is an LLM-operable wiki: source nodes, concept nodes, entity nodes, synthesis nodes, citations, commands, agents, and an edit log that Claude or ChatGPT can read from and write back into through MCP.

## Run the local app

```bash
npm run dev
```

Open `http://localhost:5173`.

The default UI is an inbox-style local vault flow:

1. Choose a vault folder.
2. Drop or upload documents into the inbox.
3. Click `Save and organize`.
4. Answer quick filing questions or add freeform notes.
5. Click `Write local vault` to save the raw sources, generated wiki, graph, and operating layer.

The left rail keeps the local vault, temporary API settings, and generated file structure visible. The main app tabs are Inbox, Wiki, Graph, Review, and Operating Layer. There is intentionally no Margins-owned chat tab.

Until API mode exists, the language-model step is still copy/paste: Margins copies the ingest prompt, you paste it into Claude/ChatGPT, then paste the returned `margins-file` blocks back into Margins. Advanced controls are available under `Advanced tools`.

Margins V1 is local-first. Public API directories include some ML and extraction APIs, but there is not a clearly suitable no-secret LLM compiler endpoint for this product contract. The current posture is therefore:

- Local compile requires no API key, paid call, hosted storage, or Margins-owned account.
- LLM compile/review is a manual handoff to a chat product the user already controls.
- Future provider integrations should be optional BYO key/provider flows, not a requirement for using the vault compiler.

The browser app has two compile paths:

- `Local compile` uses only local heuristics. It proves the folder -> wiki -> operating layer pipeline.
- `Extract PDF text` uses PDF.js in the browser to turn readable PDFs into source text.
- `Copy LLM ingest prompt` creates a Claude/ChatGPT handoff prompt. Use this after extraction; failed PDFs are listed as attachments.
- `LLM Review` parses Claude/ChatGPT output returned as `margins-file` fenced blocks and lets you preview it before accepting it as the current wiki.
- `Create vault` scaffolds the selected folder with the expected vault structure. `Open vault` selects an existing local vault and loads its existing wiki files back into the app. `Save changes` writes the accepted wiki plus original raw sources directly into the selected vault using the browser File System Access API.
- Incremental ingest keeps the loaded vault as context, sends only the new source batch to the language model, and merges returned `margins-file` blocks into the existing wiki.
- `Review Mode` controls how many material judgment questions Margins asks: Auto-file, Suggested review, or Strict review. You can answer those questions in plain English and copy a review response prompt back to the language model for revised files.
- Optional API settings are local-only browser settings used for model-generated filing questions. If a direct browser API call fails, Margins falls back to local review rules.

## Compile the sample vault

```bash
npm run compile
```

This writes a generated V1 vault to `sample/output`:

```text
sample/output/
  raw_sources/
  wiki/
    .margins/
      manifest.json
      edit-log.jsonl
      ingest-report.md
  operator-manual.md
  query-cookbook.md
  commands/
  agents/
```

Metadata belongs under `wiki/.margins/`. The compiler does not generate a root `.margins/` directory.
The CLI compile command rewrites generated wiki and operating-layer paths in its output directory; use the browser flow for proposal-first incremental saves into a working vault.

## Compile your own folder

```bash
npm run compile:custom -- /path/to/raw_sources /path/to/output
```

## Run tests

```bash
npm test
```

## Current scope

- Local-first proof of concept.
- Markdown/text files are fully supported.
- PDFs with selectable text can be extracted locally in the browser.
- No hosted storage.
- No Margins-owned chat surface.
- No required paid API calls or secrets.
- Write-back is proposal-first, never silent.
