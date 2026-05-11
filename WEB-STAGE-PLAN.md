# Margins Web Stage — Build Plan

Last updated: 2026-05-10

## Scope

This plan covers the **web app stage** of the roadmap — Phases 1 and 2 of [`PRODUCT-ROADMAP.md`](./PRODUCT-ROADMAP.md). It does **not** cover the local helper, MCP server, Claude connector, or ChatGPT app. Those are downstream and depend on a stable web vault contract.

The web stage ships when:

- A new visitor can land on the site, choose a template, pick a folder, set a model key, and reach an inbox in under ten minutes.
- The user can drop a real PDF/transcript, run `Process`, see a cited source page, and approve it into the vault — with no heuristic filler and no developer-only controls in the way.
- The user can read, in plain language, what stays local, what is sent to the model, and how to clear keys and data.
- The build is deployable as static files to a public URL.

Out of scope for this stage: streaming chat UI, hosted document storage, account login, in-app graph redesign (tracked separately in `DESIGN-NOTES.md`).

## Current Baseline (2026-05-10)

What works:

- `index.html` + `src/app.js` (10K LOC, modularized into `src/core/` + `src/views/`).
- File System Access vault create/open/save (`src/core/vault.js`, `scaffoldVault`).
- Inbox processing flow with model review (Gemini default, BYO key in localStorage via `apiSettingsStore.js`).
- PDF.js + mammoth extraction in browser.
- Compiler pass (`compiler.js`, 1.5K LOC) + tests under `tests/`.
- Design demos parked in `design-demos/` (visionOS, bauhaus, cyberpunk, polychrome).

Gaps the web stage must close:

- No landing page. The app drops users straight into the inbox.
- No template picker. `scaffoldVault` hardcodes `karpathy-original`.
- API key controls live under `Advanced` — developer-style.
- Only one key mode (persisted localStorage). No `Use once`. No clear-data button.
- No spend guardrails or model-call budget.
- No transparency / "what leaves your computer" copy anywhere.
- No demo mode — every visitor needs a key to try it.
- No streaming on long Gemini calls (TODO.md priority).
- Static deploy target not chosen.

## Architecture Decisions

| Decision | Direction | Rationale |
|---|---|---|
| Routing | Hash router (`#/setup`, `#/app`, `#/settings`) | No server config needed for static deploy. Bookmarkable. Works on GH Pages or any CDN. |
| App shell | Single `index.html`, route renders into `<main>` | Avoids splitting the build before there's a build step. Keeps `python -m http.server` dev story. |
| State | Existing `state.js` + new `setupPlan` slice | One source of truth; setup writes a `VaultSetupPlan` that `scaffoldVault` consumes. |
| Templates | Static JS map keyed by id → folder list + seed files | Connor authors the seed `operator-manual.md`/`query-cookbook.md` per template. No remote fetch. |
| Key storage | Three modes: `none` / `session` / `device` | Maps to demo / use-once / remember. `session` lives in-memory only, cleared on reload. |
| Spend cap | Per-session token budget, soft warn + hard stop | Cheaper than per-call $ tracking. User sets cap in setup; default 100K tokens. |
| Telemetry | None on key-handling routes | Phase 2 trust principle. Outside the key surface is open for later. |
| Deploy | TBD — recommend Vercel or Cloudflare Pages | Pick before M6. GH Pages works but slower iteration on previews. |

## Milestones

Each milestone ends in a deployable state. M1–M3 are the public web beta (Phase 1). M4–M5 are the trust + polish wrapper (Phase 2). M6 is the public-launch task.

### M1 — Setup wizard, routes, templates

Goal: a new visitor reaches a working inbox by completing a 4-step wizard.

Deliverables:

- Hash router in `index.html` + `src/router.js` (new). Routes: `#/`, `#/setup/template`, `#/setup/folder`, `#/setup/model`, `#/setup/review`, `#/app`, `#/settings`.
- Landing view (`src/views/landing.js`, new). Two CTAs: `Start locally` → `#/setup/template`, `Try the demo` → `#/app?mode=demo`. North-star copy from roadmap §North Star + §Core Product Promise.
- Setup wizard (`src/views/setup.js`, new). Four steps, each writes into `state.setupPlan`:
  1. **Template picker** — `general`, `student`, `practitioner`, `investor`, `custom`. One sentence each + folder preview.
  2. **Folder** — calls `showDirectoryPicker` (must run synchronously inside the click handler, see existing `vault.js` warning).
  3. **Model + key** — provider (Gemini default; OpenAI + Anthropic stubs), model id, API key, mode (`use-once` / `remember-on-this-device`), spend cap.
  4. **Review** — read-only summary; `Create vault` button calls `scaffoldVault(handle, plan)`.
- Templates registry (`src/core/templates.js`, new). Each template exports `{ id, label, description, folders[], seedFiles{path → string} }`. Seed files are short Markdown — full operator manual content can be appended later.
- `scaffoldVault(rootHandle, plan)` extended in `src/core/vault.js` to:
  - Accept a `VaultSetupPlan` (template id + custom folders).
  - Create the template's folders in addition to the base set.
  - Write the template's seed files via `writeTextFileIfMissing`.
  - Stamp `wiki/.margins/manifest.json` with the actual template id.
- Move the existing inbox view to render at `#/app` instead of being the default body.
- Migration: existing users with a vault but no `setupPlan` route to `#/app` directly (read manifest.json, hydrate state).

Decision points to confirm before starting:
- Folder lists per template (Connor — five short folder lists).
- Seed file content per template (Connor — five short operator-manual stubs OR reuse the same one for now and split later).

Files: `index.html`, `src/app.js` (entry point split — register router, mount route views), `src/router.js` (new), `src/views/landing.js` (new), `src/views/setup.js` (new), `src/core/templates.js` (new), `src/core/vault.js` (scaffold signature), `src/core/state.js` (`setupPlan` slice).

### M2 — Key handling and guardrails

Goal: API-key UX is no longer developer-style. `Use once` and spend caps work end-to-end.

Deliverables:

- `apiSettingsStore.js` extended:
  - New field `mode: 'none' | 'session' | 'device'`.
  - Session-mode keys live in a module-scoped variable, never written to `localStorage`. Cleared on `beforeunload`.
  - `clearApiSettings` removes both session and device keys.
- Spend guardrail (`src/core/budget.js`, new):
  - Tracks total tokens per session (pre-call estimate + post-call actual from response).
  - Hooks into `generateGeminiJsonContent` (`src/app.js:343`-region).
  - Soft warn at 80% of cap (modal, dismissable). Hard stop at 100% (modal, blocks `Process`).
  - Reset on session start; configurable in `#/settings`.
- Settings route `#/settings` (`src/views/settings.js`, new):
  - Current key (masked), provider, model, mode, spend cap, used-this-session.
  - `Clear key` button (mode-aware).
  - `Clear local data` button — wipes `localStorage` keys under `STORAGE_KEYS.*` AND offers to disconnect the FS handle.
  - `Open source repo` link.
- Remove API controls from `Advanced` after the same controls land in `#/setup/model` and `#/settings`. `Advanced` keeps only debug toggles.
- Audit pass — grep `console.log` and confirm no key value, response body containing key, or URL with key is logged. No key in `wiki/.margins/export-summary.json`. No key in compiled wiki Markdown.

Files: `src/apiSettingsStore.js`, `src/core/budget.js` (new), `src/views/settings.js` (new), `src/app.js` (call sites), `src/storageKeys.js`.

Tests:
- `tests/apiSettingsStore.test.js` — `mode: 'session'` does not write to localStorage; `clearApiSettings` removes both stores.
- `tests/budget.test.js` (new) — soft warn at 80%, hard stop at 100%, reset on new session.

### M3 — Trust panel and transparency

Goal: a user can read what leaves the device, what is stored where, and how to clean up.

Deliverables:

- Trust panel module rendered in `#/setup/model` and `#/settings` (`src/views/trust-panel.js`, new). Five bullets:
  1. Vault files stay in your selected folder.
  2. Source text is sent to the model only when you click `Process`.
  3. Your API key is stored {in memory only / on this device} based on your mode.
  4. Margins runs no analytics on key-handling screens.
  5. Open the repo to inspect every network call.
- First-run checklist banner on `#/app` when vault is empty: 5 short items (pick folder ✓, set key, drop file, run Process, approve).
- `Recommend a low-limit key` callout on `#/setup/model` with provider-specific links (Gemini console URL, OpenAI usage limits, Anthropic key page).
- Confirm — and lock — that no analytics or session-replay scripts load on `#/setup/*` or `#/settings`. Document the rule in `DESIGN-NOTES.md`.
- README rewritten for end-users (current `README.md` is dev-oriented). Move dev instructions to `CONTRIBUTING.md` (new).

Files: `src/views/trust-panel.js` (new), `src/views/setup.js`, `src/views/settings.js`, `src/views/inbox.js` (first-run checklist), `README.md`, `CONTRIBUTING.md` (new), `DESIGN-NOTES.md`.

### M4 — Demo mode

Goal: a visitor can click `Try the demo` and see the full ingest flow with no key.

Deliverables:

- Demo flag wired through `state` (`mode: 'demo'`).
- Bundled sample vault (reuse `margins/sample/` if present, or a new fixture under `src/demo/`).
- Demo source set: 1 PDF, 1 transcript, 1 markdown — checked in.
- Pre-recorded model responses for each demo source (`src/demo/responses.json`). `Process` returns the canned response instead of calling the API.
- Demo banner on `#/app?mode=demo`: "This is a demo. Nothing is saved. Set up a real vault to keep your work."
- Demo writes nothing to disk — `saveCurrentVault` is disabled in demo mode and shows a CTA to set up a real vault.
- Demo never asks for a key, never touches `apiSettingsStore`.

This is the only place pre-recorded model output is allowed. Roadmap §What Not To Build Yet forbids heuristic fallback for real use — demo mode is a labeled exception.

Files: `src/demo/` (new — fixtures + responses), `src/views/inbox.js` (mode branching), `src/core/vault.js` (save disabled in demo), `src/app.js` (mode plumb-through).

### M5 — Streaming, errors, progress

Goal: long ingests feel like progress, not a hung browser. Carries the existing TODO.md priority.

Deliverables:

- Stream the Gemini response (`generateGeminiJsonContent` near `src/app.js:343`). Replace the 180s synchronous wait with the streaming endpoint. Render fields as they arrive: summary first, then takeaways, then connections.
- Distinguish error states: network / auth (401) / quota (429) / model error (5xx) / parse error. Show the right next action per case ("check your key", "try again", "wait and retry", "report issue with this fixture").
- Cancel button on in-flight `Process`.
- Progress strip in inbox card: "Processing (12s)" → "Summary received (24s)" → "Done (38s)".
- Remove the 180s timeout — streaming makes it obsolete.

Files: `src/app.js` (Gemini call site), `src/views/inbox.js` (progress + cancel UI), `src/core/api.js`.

### M6 — Distribution

Goal: live at a public URL.

Deliverables:

- Pick deploy target (Vercel | Cloudflare Pages | GH Pages). Recommend Vercel for preview deploys per branch.
- Build step decision — current setup is no-build (native ESM). Confirm production-deploy-without-bundler is acceptable, or add a thin esbuild step. **Default: stay no-build until module count justifies it.**
- Configure deploy:
  - Static hosting from `margins/` directory.
  - Custom domain (Connor decides — `margins.brieflywealth.com` or a fresh domain).
  - HTTPS-only — File System Access requires it.
- Production checklist:
  - `dev` script swapped for build/preview where needed.
  - No `console.log` left from M2 audit.
  - `Advanced` controls hidden in production via `import.meta.env`-style flag.
  - Open Graph + meta tags on landing.
  - Analytics added on landing only (per M3 rule), service is Connor's choice.
- Smoke test from a fresh browser profile: landing → setup → ingest → save → reopen → reload-from-disk works end-to-end.

Files: deploy config (target-dependent), `index.html` (meta tags), `src/app.js` (production flag), `package.json` (preview script).

## Open Questions for Connor

1. Template content — five labels and folder lists, or start with `general` only and add the rest after a real user asks?
2. Spend cap default — 100K tokens/session is ~$0.50 on Gemini Flash, more on Anthropic. Pick a default and a hard cap that stays comfortable.
3. Demo source set — reuse anything from current sample/, or curate a fresh public-safe set (no Connor wiki content)?
4. Deploy target — Vercel vs. Cloudflare Pages vs. GH Pages?
5. Domain — `margins.brieflywealth.com` or a new domain (`margins.app`, `margins.run`, etc.)?
6. Production flag mechanism — query string, `localhost` check, or build-time variable? (Affects whether to keep no-build.)

## Non-Goals (Defer Until Connector Phase)

- `margins-local` helper binary — Phase 3.
- MCP server — Phase 3+4.
- Claude Desktop integration — Phase 4.
- ChatGPT app — Phase 5.
- Hosted accounts / managed inference — Phase 6.
- In-app graph redesign — separate track per `DESIGN-NOTES.md`.
- Real lint/health logic for stale summaries — `TODO.md` V1.1 (post-web-stage).

## Sequencing Note

M1 → M2 → M3 → M4 → M5 → M6 is the natural order, but M5 (streaming) can run in parallel with M2 if Connor wants to fix the hung-browser feeling earlier. M4 (demo mode) is the highest-leverage marketing investment — pull it forward if the goal is showing the product to non-technical Centric/Riviera/Bob audiences before they commit to setup.
