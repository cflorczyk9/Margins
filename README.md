# Margins

Margins is a local-first source-to-wiki compiler for LLMs.

For the product direction from local web app to Claude/ChatGPT connector, see [`PRODUCT-ROADMAP.md`](./PRODUCT-ROADMAP.md).

It turns:

```text
raw/
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
3. Click `Process` on the pending document. Margins immediately saves the original source file in `raw/`, sends readable text to the configured model with wiki context and guardrails, then prepares a short summary, connections, and at most three optional questions.
4. Answer or skip the quick questions.
5. Click `Approve` on the document to save the generated wiki, graph, and operating layer.

The left rail keeps the local vault visible and remembers the last selected vault where the browser allows it. The main app tabs are Inbox, Vault, and Graph. Review questions appear inline inside the inbox when needed. There is intentionally no Margins-owned chat tab.

Gemini can be used from the Advanced controls with a local browser key. If the direct API call fails or no key is configured, source ingest stops with an error; Margins does not create a heuristic source page.

Margins V1 is local-first storage with a required model review for uploaded sources. The current posture is therefore:

- Browser ingest uses a BYO model key stored locally in the browser.
- Original files are preserved locally in `raw/` before model review.
- Future provider integrations should remain BYO key/provider flows, not Margins-owned hosted storage.

The browser app has one source-ingest path:

- `Extract PDF text` uses PDF.js in the browser to turn readable PDFs into source text.
- `Process` sends the source to the configured model and compiles source markdown only from the returned review.
- `Compile reviewed` rebuilds wiki/operating files only for sources that already have model reviews in the current session.
- `Copy LLM ingest prompt` creates a Claude/ChatGPT handoff prompt for manual wiki-file generation.
- `LLM Review` parses Claude/ChatGPT output returned as `margins-file` fenced blocks and lets you preview it before accepting it as the current wiki.
- `Create vault` scaffolds the selected folder with the expected vault structure. `Open vault` selects an existing local vault and loads its existing wiki files back into the app. `Save changes` writes the accepted wiki plus original source files directly into the selected vault using the browser File System Access API.
- Incremental ingest keeps the loaded vault as context, sends only the new source batch to the language model, and merges the model-reviewed source pages into the existing wiki.
- `Review Mode` controls how much interruption Margins allows: Auto-file skips the summary, Suggested review shows the source summary and asks only useful questions, and Strict review keeps the same three-question cap.
- Temporary API settings are tucked under developer controls and are local-only browser settings. Gemini is the default local provider. These controls should be hidden in production.

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
- Source ingest requires a configured model key.
- Write-back is proposal-first, never silent.
