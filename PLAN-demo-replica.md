# Margins → Claude Demo Replica — Plan

Branch: `margins-demo-replica` (off `margins-claude-demo-aesthetic`, which had `f86c057 Apply Claude demo aesthetic shell` as a paint pass).

Reference target: `wiki/queries/2026-05-05-claude-margins-product-demo.html` (2,200 lines, single-file).

## Goal

Make the working margins app a near-exact visual replica of the Claude product demo HTML, while preserving every working piece of functionality already in the repo (vault read/write, ingest pipeline, API/guard settings, PDF/Word parsing, LLM review, compiler, theme toggle).

The demo is desktop-only, light-themed, four-screen. The replica should land that aesthetic first, then thread real data through it.

## What's preserved (must not break)

From `src/app.js`, `src/compiler.js`, `src/apiSettingsStore.js`, `src/vaultHandleStore.js`:

- File System Access vault create / open / reconnect (`createVault`, `openVault`, `loadExistingVault`, `vaultHandleStore.js`)
- Ingest pipeline: drop → fileInput / folderInput → setSourceFiles → review → bulk ingest → save (`saveCurrentVault`, `bulkIngestPendingSources`, `processPendingSource`, `prepareIngestReviews`)
- API settings + spend guards in localStorage (`apiSettingsStore.js`, `loadApiGuardSettings`, `apiThrottle`)
- PDF text extraction (`pdfjs-dist`) and `.docx` (`mammoth`)
- Compiler: vault → wiki/raw_sources → entity index → graph (`compileVault`, `vaultToFiles`)
- LLM ingest review flow: paste model output → parse → accept / repair (`copyLlmIngestPrompt`, `acceptLlmFiles`, `copyLlmRepairPrompt`)
- Operator manual + query cookbook + agents/commands renders
- Edit proposals
- Theme toggle (light/dark) — even though demo is light-only, dark mode stays as a setting

Anything not on this list (graph view, ops view, llm utility view) gets demoted from primary nav but the code stays intact through the visual rebuild. Decisions about deletion happen in a later commit.

## Architectural mapping

| Current view | Demo view | Action |
|---|---|---|
| `#inbox-view` (Inbox) | Activity | Rebuild as upload zone + streaming reveal + card wall |
| `#wiki-view` (Vault, split tree+editor) | Files | Rebuild as ownership callout + stats bar + tree + preview, edit-toggle to keep textarea |
| `#graph-view` | — | Hide from primary nav, keep DOM hidden behind a dev/diagnostics flag, schedule deletion in M7 |
| `#llm-view` (utility) | — | Hide from primary nav, keep code, surface via Advanced |
| `#ops-view` (utility) | — | Hide from primary nav, keep code, surface via Advanced |
| (none) | Entities | New view — read entity index from compiler, render chips + pinned grid + active list |
| (none) | Chat | New stub view — placeholder hero or first-message composer wired to chatbar |

## View-by-view target

### Sidebar (248px, demo aesthetic)

Demo sidebar has: brand, Workspace nav (4), Pinned nav (4), Discovery callout. That's it.

Current sidebar has: brand, Workspace tabs (3), Pinned, Vault card (status + Create / Open / Choose-folder), structure-card with Ingestion stats grid, Discovery, `<details>` Advanced (API + spend guards + review mode + Extract / Compile / LLM / Export / Copy buttons), theme toggle.

Plan:
- Keep brand, Workspace nav, Pinned, Discovery (visually demo-identical)
- Pinned nav goes dynamic: read entities with `priority: pinned` from compiler instead of the current hardcoded list
- Discovery callout stays a static placeholder until a real cross-bucket discovery engine exists
- Move OUT of sidebar into a Settings drawer triggered by a gear button in sidebar footer:
  - API provider / model / key
  - Spend guard inputs (six fields + reset)
  - Review mode select
  - Extract / Compile / LLM / Export / Copy buttons (these are dev/diagnostic)
  - Theme toggle
- Vault status: compact footer label `Vault · ~/margins/vault` clickable → opens connect dialog when no vault is connected
- Ingestion stats grid: deleted from sidebar; same numbers surface in Activity meta-row instead

### Activity view

Page-head: H1 `Activity`, meta-row (`Tuesday, May 5 · 4 ingests this week · 23 entity updates`), `All sources` sub on the right.

Upload zone (`.upload`): rounded dashed card, icon, title (`Drop a file, paste a link, or forward an email`), sub (`PDFs, transcripts, photos, voice notes, web clippings`), CTA button. Clickable + drop target. Hover paints accent border + softer accent background.

Streaming reveal (`.streaming`): replaces upload zone while a real ingest is in flight. Has a stream-head (PDF thumb + title + sub + status), and stream-lines that append as lifecycle events fire. On final, stream-actions appear (Open entity / Ask Margins / Done). Click Done → reveal collapses, fresh card lands at top of wall.

Card wall (`.wall`): one card per recent source page, sorted by `event_date` desc. Each card has source-icon (pdf / eml / txt / aud — derived from extension or category), title, date, summary (from frontmatter), entity pills, foot stats.

Wire to real ingest lifecycle (events to add):
- `parse_started` → "Reading PDF — N pages, ~M words"
- `entities_detected` → "Detected N entities · M already in your brain"
- `source_created` → "Created [pill] as a new source"
- `entity_updated` (per entity) → "Updated [pill] · ..."
- `entity_linked` → "Linked to [pill] (N prior mentions)"
- `contradiction_flagged` (insight class) → "Discovered: ..."
- `filed` → "Filed source page · X entity updates · Y flagged"

If full lifecycle telemetry is too invasive, M6 ships fake-but-believable timing first and threads real events later.

### Entities view

Page-head: H1 `Entities`, meta-row counts.

Toolbar row: search input with `⌘F` kbd, focus ring in accent.

Two chip rows:
- Type chips: All / People / Companies / Projects / Concepts / Sources (counts from compiler)
- Region chips: briefly / riviera / compete / intel / people / build / ideas / self (from `region/` tags)

Active chip filters the list below.

Pinned grid (2-col): pinned-card per `priority: pinned` entity. Vibe dot (peak/fresh/recent/aged/old), name, type-tag, meta line, summary (2-line clamp), next move.

Recently active list (`.entity-list`): rows for entities by `updated:` desc. Vibe dot, name + type-tag, summary, last-touch, hover arrow.

Click any card or row → entity panel slide-out.

### Files view

Page-head: H1 `Files`, meta-row (`Your brain, as plain markdown.`).

Ownership callout (`.ownership-callout`): icon block + body (`You own these files.` + paragraph about ~/margins/vault + Obsidian/Cursor/VS Code).

File stats bar (`.file-stats`): four stat-blocks (count, size, last sync, sync indicator) + actions (Export ZIP, Sync settings, Open in editor).

File layout (`.file-layout`, 2-col grid): tree (left, 240px, collapsible folders, active file) + preview (right).

Preview (`.file-preview`): mono breadcrumb, large title, frontmatter block (mono, syntax-colored fk/fv/fc), rendered body (h2 / ul / strong / wikilink). Markdown rendering needs a tiny renderer (markdown-it or hand-rolled).

Edit mode: Edit button on preview swaps body for the existing textarea + Save. Save uses the current `doc-save-btn` path.

### Chat view

Stub. Centered hero `Coming soon — talk to your brain` plus a first-message composer that just routes input into the existing chatbar at the bottom. Defer real chat backend.

### Entity panel slide-out

Right-side `.entity-panel` (380px, `transform: translateX(110%)` → `none` on `.open`), `.scrim` overlay.

Triggered by:
- Activity card click
- Pill click (anywhere)
- Pinned-card click (entities view OR sidebar)
- Entity-row click
- Stream-actions "Open [entity]" button

Sections:
- Tag pill (`Person` / `Company` / `Project`)
- Entity name (large)
- Sub-line (firm + city + role)
- Snapshot (3–5 bullets from entity-page Snapshot section)
- Recent in your brain (Source Log rows: title + when)
- Connected to (pills for related entities — from `key_links` frontmatter or graph edges)
- `Ask Margins about [name] →` button → wires into chatbar

### Chatbar (already structurally correct)

Confirm CSS matches demo: 14px radius, `⌘K` hint left of separator, send button hover→accent, fixed bottom centered with `left: calc(248px + (100vw - 248px) / 2)`.

## File-by-file changes

### `index.html`

Restructure DOM to mirror demo:
- `<div class="app">` (CSS Grid 248px / 1fr) replaces `<div class="app-shell">`
- `<aside class="sidebar">` — brand, Workspace nav (4 items), Pinned nav (dynamic), Discovery, gear button → settings drawer
- `<main class="main"><div class="main-inner">` — four `<section class="view" data-view="...">` wrappers
- `<div class="entity-panel">` + `<div class="scrim">` siblings of main
- `<label class="chatbar">` stays fixed at bottom

Preserve every input ID app.js depends on (file-input, folder-input, source-list, queue-panel, doc-body, etc.) — they relocate but keep IDs.

### `styles.css`

The shell commit painted existing classes; demo componentry classes are mostly missing. Port from demo HTML:
- `.app` grid + `.sidebar` minimal layout
- `.brand-dot`, `.brand-name`, `.nav-section-label`, `.nav a`, `.nav a.active`, `.discovery`, `@keyframes pulse`
- `.upload`, `.upload-icon`, `.upload-cta`
- `.streaming`, `.stream-head`, `.stream-thumb`, `.stream-meta`, `.stream-status`, `.stream-lines`, `.stream-line`, `.stream-line.insight`, `.stream-pill`, `.stream-actions`, `@keyframes stream-in`, `@keyframes pulse-dot`, `@keyframes line-in`
- `.wall`, `.card`, `.card.fresh`, `@keyframes card-land`, `.card-top`, `.source-icon.pdf/.eml/.txt/.aud`, `.card-title`, `.card-date`, `.card-summary`, `.card-pills`, `.pill`, `.card-foot`
- `.toolbar-row`, `.search`, `.search:focus-within`, `.chips`, `.chip`, `.chip.active`
- `.section-head h3` (uppercase kicker), `.pinned-grid`, `.pinned-card`, `.vibe.peak/.fresh/.recent/.aged/.old`, `.entity-list`, `.entity-row`, `.entity-row .arrow`
- `.ownership-callout`, `.file-stats`, `.file-layout`, `.file-tree`, `.tree-folder`, `.tree-file`, `.tree-children`, `.tree-folder.collapsed`
- `.file-preview`, `.preview-breadcrumb`, `.preview-title`, `.preview-fm` (with `.fk/.fv/.fc`), `.preview-body` (h2/ul/strong/.wikilink)
- `.chatbar` (audit against demo's exact rules)
- `.entity-panel`, `.entity-panel.open`, `.entity-name`, `.entity-tag`, `.entity-section`, `.entity-snap li`, `.entity-source-row`, `.entity-related`, `.entity-ask`
- `.scrim`, `.scrim.show`
- `:root` palette (already in shell — reconcile against demo's exact hex values)

Then audit the existing 4,115 lines for any selectors that conflict with the new classes.

### `src/app.js`

- View switching: extend the existing tab handler to four primary views (`activity` / `chat` / `entities` / `files`) plus utility-views accessible via Settings (`ops`, `llm`, `graph`)
- New `openEntity(slug)` / `closeEntity()` handling `.entity-panel` + `.scrim`
- Replace source-list rendering with `renderActivityWall(sources)` producing demo-shaped cards
- Replace tree+textarea rendering with `renderFilesView(vault)` producing demo-shaped tree + preview, with an Edit toggle that swaps to the existing textarea + Save flow
- New `renderEntities(entityIndex, filterState)` driving chips + pinned grid + active list
- New stream-line renderer driven by ingest lifecycle events
- Wire all card / pill / row click sites to `openEntity`
- Sidebar Pinned: render from compiler entity-index `priority: pinned` slice
- Settings drawer: mount API + guard + review-mode + dev buttons + theme toggle inside it; trigger via gear button
- Vault footer label: small element showing `Vault · <last-2-path-segments>` or `Connect a vault →` if not connected

### `src/compiler.js`

Extend (or add `getEntityIndex` helper) to return alongside existing output:
- `entityIndex: [{ slug, name, type, priority, summary, lastContact, nextMove, vibrance, region, sourceCount, related[], firm, role }]`
- `sourceCards: [{ path, kind, title, date, summary, pills, entityCount, sourceLinkCount }]`
- `pinnedShortcuts: [{ slug, name, color }]` — derive color from region tag
- `discovery: { text, entityRefs[] }` — placeholder until a real engine

On-disk vault format unchanged.

### NEW `src/markdown.js`

Tiny renderer (no dependency if it stays small):
- `renderMarkdown(body)` → HTML for h2 / ul li / strong / `[[wikilink]]` → `<span class="wikilink" data-slug="...">name</span>` / paragraphs
- `renderFrontmatter(yamlBlock)` → `.preview-fm` HTML with fk/fv/fc spans

### NEW `src/streamingEvents.js` (optional, M6)

Lightweight emitter so the ingest pipeline can fire lifecycle events the Activity view can listen for. If too invasive, defer and use simulated timing in M6.

## Risks and open questions

1. **Sidebar density.** Demo has 4 nav + 4 pinned + Discovery. Current has all of that plus a vault card, ingestion stats, and an Advanced panel with twelve inputs and six buttons. Settings drawer is the proposal. If Connor would rather keep Advanced inline as a `<details>`, that's also acceptable but visually divergent from demo.
2. **Vault create / open.** Demo presumes a vault already exists. If no vault is connected, the replica needs *some* affordance — a footer prompt + dialog seems right. Confirm with Connor.
3. **Files view edit affordance.** Demo is read-only. Current saves edits. Edit-toggle approach keeps both. Worth confirming Connor wants edit kept (vs. Files being purely a viewer with editing happening elsewhere).
4. **Graph view fate.** Memory says "no graph" is the v2 architectural decision. Hide in M1, delete in M7.
5. **Streaming lifecycle telemetry.** Real per-step events require threading through `processPendingSource` / Gemini call / save. M6 first ships simulated timing, swaps to real events as a follow-up.
6. **Discovery engine.** Doesn't exist. Static placeholder until a real cross-bucket pattern detector ships.
7. **Theme toggle.** Demo is light-only. Dark mode stays as an option in Settings drawer; the demo replica look ships against `--bg: #faf7f2` first.
8. **Markdown rendering depth.** Demo body uses h2 / ul / strong / wikilink only. Not full CommonMark. Hand-rolled `markdown.js` should be enough; reach for `markdown-it` only if vault content uses richer constructs (tables, code blocks, links beyond wikilinks).

## Milestones

Each milestone is one commit unless noted. Each ships independently usable.

### M1 — Shell parity (1 commit)
Visual replica with current functionality plumbed through. After M1 the app looks like the demo on first load with a connected vault.
- Restructure `index.html` to demo DOM (preserve every input ID)
- Port demo componentry CSS into `styles.css`
- Hide Graph / LLM / Ops from primary nav (keep DOM, accessible via temporary Advanced surface)
- Wire 4-view switching
- Source list rendering still produces old DOM but lives inside the Activity layout — proper card rendering is M2

### M2 — Activity card wall (1–2 commits)
- `renderActivityWall` replaces source list rendering
- Source-kind icon detection (extension → pdf/eml/txt/aud)
- Entity pill rendering from source frontmatter wikilinks
- Card foot stats from compiler

### M3 — Entities view (1–2 commits)
- Compiler extension: `entityIndex` with vibrance/region/related
- Pinned grid + recently active list
- Search + chip filters (client-side, instant)
- Sidebar Pinned wired to dynamic data

### M4 — Entity panel slide-out (1 commit)
- `.entity-panel` + `.scrim` DOM and CSS
- `openEntity(slug)` populates from entity index
- Wire all click sites (cards, pills, rows, sidebar Pinned, stream-actions)

### M5 — Files view replica (1–2 commits)
- File-stats bar
- Demo-shaped tree (collapsible folders, active file)
- Preview component with `markdown.js` render + frontmatter highlight
- Edit toggle preserving existing textarea + Save

### M6 — Streaming reveal (1 commit)
- Hook ingest lifecycle to `.stream-lines` (real or simulated)
- Card lands fresh at top of wall on Done
- Stream-actions wire (Open entity, Ask, Dismiss)

### M7 — Polish + cleanup (1 commit)
- Settings drawer for API / guard / dev buttons / theme toggle
- Vault footer label
- Discovery callout (placeholder)
- Delete graph view code
- Final side-by-side audit against the demo

## Out of scope for this branch

- Real chat backend
- Real discovery engine
- Mobile responsiveness (demo is desktop-only)
- New auth / Supabase integration
- Dark-mode parity

## Done definition

- Open `margins/index.html` and `wiki/queries/2026-05-05-claude-margins-product-demo.html` side-by-side at 1440×900. Sidebar matches at 248px. Activity / Entities / Files views look ≥95% identical.
- Connect a real vault, ingest a real PDF, watch the streaming reveal, see the fresh card land, click it, see the entity panel populate from real data.
- All current automated tests pass (`tests/`).
- No console errors on first load with or without a connected vault.
