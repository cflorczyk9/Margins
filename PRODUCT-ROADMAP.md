# Margins Product Roadmap

Last updated: 2026-05-10

## North Star

Margins should become the local-first setup layer that turns a user's files into a Claude/ChatGPT-operable Markdown wiki.

The first useful product is a web app where a user can pick a local folder, choose a template, add files, and generate a structured vault. The end-state product is a Claude/ChatGPT connector where the user can operate the same vault from inside their existing AI subscription, without paying a separate Margins API fee for normal foreground work.

## Core Product Promise

```text
Pick a folder.
Margins creates a local vault.
Drop files into it.
Claude or ChatGPT can read, organize, and update the vault with citations.
```

Margins is not mainly a chat app and not mainly a generic file organizer. It is the wiring layer between local source files and a durable model-operable wiki.

## Important Platform Reality

The standalone Margins web app cannot simply use a user's Claude.ai or ChatGPT login as API compute. Claude/ChatGPT subscriptions and developer APIs are separate products. Trying to automate a consumer chat login from Margins would be fragile, suspicious, and likely the wrong platform posture.

The right way to avoid API keys is different:

- In standalone Margins, model calls require either the user's API key, a local model, or Margins-managed compute.
- In Claude or ChatGPT, Margins can become a connector/app/tool. The user works inside Claude or ChatGPT, and that host product supplies the model reasoning through the user's subscription.
- Margins supplies the local vault, file tools, operating rules, and write-back discipline.

So the roadmap should not be "make the web app log into Claude." It should be "ship a web app that creates the vault, then ship connectors that let Claude/ChatGPT operate that vault."

## End-State User Experience

1. User visits Margins and clicks `Start locally`.
2. User chooses a vault template: general, student, practitioner, investor, or custom.
3. Margins creates the local folder structure:

```text
raw/
wiki/
  sources/
  concepts/
  entities/
  synthesis/
  personal/
  relationships/
  daily/
  ideas/
  [template folders...]
  .margins/
commands/
agents/
CLAUDE.md
operator-manual.md
query-cookbook.md
```

4. User drops files into Margins.
5. Early mode: Margins processes files with a user-provided API key.
6. Final mode: user connects the vault to Claude/ChatGPT and says, "Ingest these files into my Margins vault."
7. Claude/ChatGPT calls Margins tools, proposes changes, and writes only after approval.

## Architecture

### 1. Web App

The web app is the onboarding and vault-management surface.

Responsibilities:

- Landing page and setup flow.
- Template/persona folder selection.
- Local folder picker using browser file access.
- API key setup for early direct processing.
- File drop/upload.
- Inbox cards, retry, delete, approve.
- Wiki file browser.
- Vault health and maintenance views.

The web app should stay local-first:

- Raw files stay in `raw/`.
- Generated Markdown stays in `wiki/`.
- API keys are local-only by default.
- No hosted document storage in V1.

### 2. Local Helper

The local helper is the bridge from browser prototype to real connector product.

Responsibilities:

- Read and write the selected vault folder.
- Store API keys in `.env` or OS keychain for direct mode.
- Expose local HTTP endpoints for the web app.
- Expose MCP tools for Claude Desktop / ChatGPT-style clients.
- Run long ingest jobs without freezing the browser.
- Provide a stable permission boundary around local files.

This is also the foundation for the no-API-key end state.

### 3. MCP / Connector Layer

The connector layer exposes the user's Margins vault to Claude/ChatGPT.

Read tools:

- `search_vault`
- `list_pending_sources`
- `read_source`
- `read_page`
- `get_related_pages`
- `get_vault_health`

Proposal tools:

- `propose_source_ingest`
- `propose_entity_update`
- `propose_synthesis_note`
- `propose_link_cleanup`
- `audit_claim_against_sources`

Write tools:

- `write_approved_files`
- `append_operation_log`
- `mark_source_processed`

Writes should remain proposal-first. Claude/ChatGPT can draft changes, but Margins should make approval and provenance visible.

## Roadmap

### Phase 0: Current Local Prototype

Status: mostly built.

Current shape:

- Browser app can create/open a local vault.
- Browser app can preserve raw files.
- Source pages require model review.
- Heuristic source summaries have been removed.
- Gemini/API mode exists under advanced settings.
- Files and activity have delete flows.

Remaining problems:

- Setup wizard from the prototype is not wired into real vault scaffolding.
- API settings are still developer-style controls.
- Long model calls need better streaming/progress.
- No local helper yet.
- No Claude/ChatGPT connector yet.

### Phase 1: Public Web Beta

Goal: get the app into technical and semi-technical users' hands quickly.

Build:

- Real landing/setup/app route flow.
- Template picker from the original prototype.
- Provider/model/API key setup.
- `Use once` API key mode.
- `Remember on this device` API key mode.
- Spend guardrails.
- Local vault folder creation.
- Real template folder scaffolding.
- Clean inbox processing flow.
- Clear error states when the model fails.

Positioning:

> Margins organizes your files into a local Markdown wiki using your own model key.

This phase is not the final no-API-fee version. It is the fastest credible way to get usage and feedback.

### Phase 2: Trust And Distribution Polish

Goal: make API-key mode feel inspectable instead of sketchy.

Build:

- Open-source repo link from setup.
- Network transparency copy.
- `Clear key` and `Clear local data` actions.
- No analytics/session replay on key setup.
- Key never appears in logs, Markdown, URLs, or exported files.
- Recommend a dedicated low-limit key.
- Add a first-run checklist and demo vault.
- Add "what leaves your computer" copy.

Trust principle:

> Users should not have to trust Margins blindly. They should be able to inspect what it stores, what it sends, and what it writes.

### Phase 3: Local Helper

Goal: reduce browser limitations and prepare for MCP.

Build:

- `margins-local` install/run flow.
- Localhost API for vault read/write.
- Background job runner for long books/transcripts.
- Local key storage outside the hosted web page.
- Folder watch mode for `raw/`.
- Basic MCP server exposing read-only vault tools.

This changes the trust story:

```text
Hosted web page = UI
Local helper = file access + secrets + MCP server
Model provider = only receives source text when user runs ingest
```

### Phase 4: Claude Connector

Goal: let users operate Margins from Claude using their existing Claude subscription for foreground work.

Build first for Claude Desktop/local MCP if that is the fastest path to local files.

Core flow:

1. User runs `margins-local`.
2. User adds Margins as an MCP server in Claude.
3. Claude can search/read the local vault.
4. Claude can propose ingest updates.
5. Margins writes approved Markdown back to the local folder.

Why Claude first:

- MCP is Anthropic-native.
- Margins's operating-layer concept maps cleanly to Claude.
- Early users are likely to understand Claude Desktop / MCP setup.

This is the first version where the main product can honestly say:

> Use your Claude subscription to operate your Margins vault.

Limit:

Background or scheduled work still needs API compute unless Claude itself is actively running the task in a user session.

### Phase 5: ChatGPT App / Connector

Goal: provide the same "use your existing subscription" path for ChatGPT users.

Build:

- ChatGPT app/connector surface.
- Tool descriptions optimized for ChatGPT tool selection.
- Read-only tools first.
- Proposal write tools second.
- Interactive setup/status component if useful.

Open issue:

ChatGPT cloud-hosted app flows may need a publicly reachable server. Local-file access may require a local helper plus a secure pairing/tunnel pattern. This should be designed after Claude MCP proves the vault/tool contract.

### Phase 6: Managed Convenience Layer

Goal: make the product easier for non-technical users without abandoning local-first.

Possible additions:

- Margins account for preferences only.
- Optional encrypted key vault.
- Optional cloud job runner.
- Optional sync of setup templates, not documents.
- Paid managed inference for users who do not want API keys.

This should come after the connector path is validated. It adds operational burden and a bigger trust surface.

## Product Modes

### Direct Mode

User runs Margins directly.

Compute options:

- BYO API key.
- Local helper API key.
- Local model.
- Optional Margins-managed compute later.

Best for:

- Early beta.
- Power users.
- People who want a dedicated ingest app.

### Connector Mode

User runs Margins through Claude/ChatGPT.

Compute source:

- Claude/ChatGPT subscription supplies foreground model reasoning.

Best for:

- The final mainstream story.
- Users who already live in Claude or ChatGPT.
- Avoiding a separate API-key ask for normal use.

Constraint:

- Margins is a tool layer in this mode. It should not pretend to be the model.

## What Not To Build Yet

- Do not build a Margins-owned chat app as the main surface.
- Do not store user documents in Margins cloud in V1.
- Do not require account login before local use.
- Do not try to automate Claude.ai or ChatGPT consumer web sessions.
- Do not make heuristic summaries a fallback for missing model calls.
- Do not silently mutate the vault without review.

## Near-Term Implementation Checklist

1. Move the prototype setup wizard into the real app shell.
2. Convert setup choices into a `VaultSetupPlan`.
3. Update `scaffoldVault()` to accept the setup plan and create template folders.
4. Move provider/model/API-key controls out of `Advanced` and into setup.
5. Keep `Advanced` only for developer/debug controls.
6. Add local-only key storage choices: `Use once`, `Remember on this device`.
7. Add a trust panel explaining exactly what leaves the device.
8. Add a demo mode that needs no key and writes no files.
9. Build `margins-local` as the future MCP helper.
10. Expose read-only MCP tools first, then proposal-write tools.

## Success Criteria

The product is working when:

- A new user can create a local vault in under ten minutes.
- A user can drop a real PDF/transcript/book and get a cited source page without heuristic filler.
- The generated vault is readable in Obsidian, Finder, VS Code, Claude, and ChatGPT.
- Users understand where their files and keys are stored.
- Claude can operate the same vault through MCP without requiring a separate Margins API key for foreground work.

## Strategic Bet

The fastest path to adoption is not to wait for perfect Claude/ChatGPT subscription integration. The fastest path is to ship a trustworthy local web beta now, then make the same vault usable from Claude and ChatGPT through connectors.

The durable product is the vault and operating layer. The model surface can change.
