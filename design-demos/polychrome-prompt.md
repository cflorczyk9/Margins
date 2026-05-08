# Drop-in prompt — polychrome pass for Margins

Paste the block below into a Claude Code session running in `~/Documents/connor_brain2/margins/`. The prompt is self-contained, tells the executor what to verify, what to change, and where to stop.

---

You are working in the Margins repo at `~/Documents/connor_brain2/margins/` (remote: `github.com/cflorczyk9/Margins.git`). Make the three feature changes below in three separate commits on one feature branch named `polychrome-pass`. After the third commit, run the local verification, then **stop and report back to Connor**. Do not push the branch or open a PR until Connor confirms the local test passed.

## Pre-flight (do this first, once)

1. Run `git fetch origin && git status`. Confirm the working tree is clean. If not, ask Connor before proceeding.
2. Run `git checkout -b polychrome-pass` from `main` (or the current branch Connor is on if `main` isn't checked out — confirm first).
3. Open `styles.css` and `index.html` and `src/app.js` once to ground yourself in the current state. Anchor on selector text and grep-able patterns, not line numbers — line numbers in this prompt are hints only.

The line-number hints below were captured against commit `3fd1a44`. Use them to find the right block; verify by reading the surrounding selector text.

---

## Feature A — Polychrome tokens + colored nav icons

Goal: each sidebar tab tinted its own color (Activity vermillion, Entities cobalt, Files mustard) by tinting the existing SVG icons. The nav SVG icons already use `stroke="currentColor"`, so changing the tab's text color recolors the icon for free.

### Edit 1 — `styles.css` token block (around lines 1-41, the `:root, [data-theme="light"]` block)

Add these tokens at the **bottom** of the existing `:root, [data-theme="light"]` block, just before the closing `}`. Do not touch any existing token.

```css
  /* Polychrome — landing-page saturation */
  --vermillion: #d63a2f;
  --cobalt:     #2c5aa0;
  --mustard:    #f0c14b;
  --violet:     #6a4f8c;
  --green-poly: #6fa863;
  --ink-poly:   #1a1612;

  /* Per-tab tint */
  --tab-activity: var(--vermillion);
  --tab-entities: var(--cobalt);
  --tab-files:    var(--mustard);
```

Add the parallel set to the **bottom** of the `[data-theme="dark"]` block (around lines 43-70), with desaturated values for legibility on dark:

```css
  --vermillion: #ee5b4f;
  --cobalt:     #6f9bdf;
  --mustard:    #ecbf66;
  --violet:     #aa8ad4;
  --green-poly: #82c479;
  --ink-poly:   #f1eee7;
  --tab-activity: var(--vermillion);
  --tab-entities: var(--cobalt);
  --tab-files:    var(--mustard);
```

### Edit 2 — `styles.css` add nav-tint rules

Find the `.nav .tab` block (search for `^\.nav \.tab` — it's around line 3850, inside the sidebar styling section). Add this block immediately after the existing `.nav .tab` rules:

```css
.nav .tab[data-view="inbox"]    { --tab-color: var(--tab-activity); }
.nav .tab[data-view="entities"] { --tab-color: var(--tab-entities); }
.nav .tab[data-view="wiki"]     { --tab-color: var(--tab-files); }

.nav .tab svg {
  color: var(--tab-color, var(--muted));
  transition: color 160ms ease, transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
}

.nav .tab:hover svg { transform: scale(1.08); }

.nav .tab.active {
  background: color-mix(in srgb, var(--tab-color, var(--accent)) 12%, transparent);
}
.nav .tab.active svg { color: var(--tab-color); }
```

If `.nav .tab` already has explicit `color:` declarations on hover/active that fight the SVG color, the SVG color rule above wins because it targets `svg` directly. Verify by opening the running app — if the SVG icons inherit text color and override the tint, add `!important` to `.nav .tab svg { color: var(--tab-color, var(--muted)) !important; }` only as a last resort.

### Verify Feature A locally

Open the app (`npm run dev` or however the project starts — check `package.json` `scripts`). Confirm:
- Activity tab icon is vermillion red
- Entities tab icon is cobalt blue
- Files tab icon is mustard yellow
- Active tab shows a faint colored tint behind the icon
- Dark mode (toggle the theme switch) keeps icons visible against the dark background

### Commit 1

```
git add styles.css
git commit -m "Add polychrome tokens and tint nav icons per tab"
```

---

## Feature B — Kandinsky composition behind the drop zone

Goal: a positioned SVG painting sits behind the dashed-frame drop zone at half opacity, waking to 0.85 opacity on hover or drag.

### Edit 3 — `index.html` around line 140

Find this line:

```html
<section id="source-drop-zone" class="source-drop-zone inbox-drop" role="button" tabindex="0" aria-label="Choose files or drag them into Margins">
```

Insert this SVG immediately after that opening `<section>` tag, before the existing `<div class="drop-mark" aria-hidden="true"></div>`:

```html
  <svg class="drop-art" viewBox="0 0 600 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <line x1="20" y1="320" x2="580" y2="40" stroke="#1a1612" stroke-width="0.6" opacity="0.4"/>
    <path d="M 40 80 Q 300 180 560 60" fill="none" stroke="#2c5aa0" stroke-width="2" stroke-linecap="round" opacity="0.7"/>
    <g style="mix-blend-mode: multiply;">
      <circle cx="450" cy="120" r="62" fill="#f0c14b"/>
      <circle cx="450" cy="120" r="36" fill="#d63a2f"/>
      <circle cx="450" cy="120" r="11" fill="#1a1612"/>
    </g>
    <polygon points="60,200 220,230 130,330" fill="none" stroke="#1a1612" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="120" cy="100" r="9"  fill="#6a4f8c"/>
    <circle cx="320" cy="280" r="6"  fill="#6fa863"/>
    <circle cx="40"  cy="280" r="4"  fill="#d63a2f"/>
    <circle cx="540" cy="280" r="3"  fill="#1a1612"/>
    <circle cx="240" cy="60"  r="2"  fill="#1a1612"/>
    <line x1="80" y1="120" x2="130" y2="140" stroke="#1a1612" stroke-width="1" stroke-linecap="round"/>
  </svg>
```

### Edit 4 — `styles.css` add drop-art rules

Find the second `.inbox-drop` block (the override around line 1488 that sits under the comment `/* Endpoint inbox polish: keep the app quiet, file-first, and close to the landing mock. */`). Append these rules immediately after that block:

```css
.inbox-drop { position: relative; }

.drop-art {
  position: absolute;
  inset: 0;
  width: 100%; height: 100%;
  opacity: 0.5;
  pointer-events: none;
  z-index: 0;
  transition: opacity 360ms ease;
}

.inbox-drop > *:not(.drop-art) { position: relative; z-index: 1; }

.inbox-drop:hover .drop-art,
.inbox-drop.dragging .drop-art { opacity: 0.85; }
```

Dark-mode adjustment: also add this block right after, so the painting doesn't blow out on dark backgrounds:

```css
[data-theme="dark"] .drop-art { opacity: 0.32; }
[data-theme="dark"] .inbox-drop:hover .drop-art,
[data-theme="dark"] .inbox-drop.dragging .drop-art { opacity: 0.6; }
```

### Edit 5 — `DESIGN-NOTES.md`

The current note at the bottom says: *"The Inbox drop zone should keep the artistic Kandinsky-style Margins visual language while staying simple."* Append a paragraph confirming the intent has now landed:

```
The drop zone now carries a Kandinsky composition (yellow disk with vermillion + ink core, cobalt arc, open black triangle, scattered violet/green/ink dots) behind the dashed frame at 0.5 opacity, waking to 0.85 on hover or drag. The "Endpoint inbox polish" stayed quiet on the *frame*; the *art* lives inside.
```

### Verify Feature B locally

- Drop zone shows the painting at half-opacity behind the headline + button at rest
- Headline and Choose-files button are still readable
- Hovering the drop zone wakes the painting to ~0.85 opacity
- Dragging a file over the drop zone (`.inbox-drop.dragging`) triggers the same wake
- Dark mode shows the painting at lower opacity (~0.32) and stays legible

If the painting dominates the headline at rest in light mode, drop the base opacity from 0.5 to 0.4 and re-check.

### Commit 2

```
git add styles.css index.html DESIGN-NOTES.md
git commit -m "Add Kandinsky composition behind drop zone with hover wake"
```

---

## Feature C — Polychrome dots on entities + activity

Goal: the entity-card vibrance dot becomes type-colored (vibrance demoted to a halo around it). Activity-card source icons saturate to landing-page polychrome.

### Edit 6 — confirm the entity record type field

Open `src/app.js` and find the `entityVibeClass` function (around line 8861) and the entity-card render template (around line 8083). Look at the `record` object passed in: confirm what field carries the entity type. Likely candidates: `record.type`, `record.entityType`, `record.typeKey`, `record.typeLabel`. Search the file for where records are constructed to find the canonical field.

If you find a string field that takes values like `"person"`, `"project"`, `"company"`, `"concept"`, `"source"`, `"school"`, `"tool"` — that's the one. Use its name in the next edit (substituting for `record.type`).

If the field is `record.typeLabel` and it's a display string like `"Person"` instead of a slug like `"person"`, lowercase + slugify it inline: `(record.typeLabel || "").toLowerCase().split(" ")[0]`.

If you cannot find a clean type field, **stop and ask Connor** — do not guess.

### Edit 7 — `src/app.js` render template

Find this line in the entity-card template (around line 8085):

```js
<span class="entity-vibe ${escapeHtml(entityVibeClass(record))}"></span>
```

Replace it with (substituting the verified type field for `record.type`):

```js
<span class="entity-vibe ${escapeHtml(entityVibeClass(record))} t-${escapeHtml(record.type || "concept")}"></span>
```

### Edit 8 — `styles.css` recolor `.entity-vibe`

Find the `.entity-vibe` block (around lines 4335-4363). Replace the entire `.entity-vibe` block and its `.peak/.fresh/.recent/.aged/.old` variants with this:

```css
.entity-vibe {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--ink-poly);
  flex: 0 0 auto;
  position: relative;
  transition: box-shadow 200ms ease, opacity 200ms ease;
}

/* Color by type */
.entity-vibe.t-person  { background: var(--vermillion); color: var(--vermillion); }
.entity-vibe.t-project { background: var(--green-poly); color: var(--green-poly); }
.entity-vibe.t-company { background: var(--cobalt);     color: var(--cobalt); }
.entity-vibe.t-concept { background: var(--violet);     color: var(--violet); }
.entity-vibe.t-source  { background: var(--mustard);    color: var(--mustard); }
.entity-vibe.t-school  { background: var(--mustard);    color: var(--mustard); }
.entity-vibe.t-tool    { background: var(--violet);     color: var(--violet); }
.entity-vibe.t-book    { background: var(--cobalt);     color: var(--cobalt); }
.entity-vibe.t-movie   { background: var(--violet);     color: var(--violet); }

/* Vibrance becomes a halo around the typed dot */
.entity-vibe.peak   { box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 30%, transparent); }
.entity-vibe.fresh  { box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 22%, transparent); }
.entity-vibe.recent { /* no halo, full color */ }
.entity-vibe.aged   { opacity: 0.6; }
.entity-vibe.old    { opacity: 0.4; }
```

### Edit 9 — `styles.css` polychrome the source icons

Find the `.source-icon.pdf/eml/doc/txt/aud` blocks (around lines 4674-4697). Replace each variant with the polychrome version below. Leave the base `.source-icon` rule (around line 4659) untouched.

```css
.source-icon.pdf { background: color-mix(in srgb, var(--vermillion) 14%, transparent); color: var(--vermillion); }
.source-icon.eml { background: color-mix(in srgb, var(--green-poly) 16%, transparent); color: var(--green-poly); }
.source-icon.doc { background: color-mix(in srgb, var(--cobalt) 14%, transparent);     color: var(--cobalt); }
.source-icon.txt { background: color-mix(in srgb, var(--violet) 14%, transparent);     color: var(--violet); }
.source-icon.aud { background: color-mix(in srgb, var(--mustard) 18%, transparent);    color: #8d5f00; }
```

The `.aud` text color stays brown (not mustard) because mustard text on mustard tint is unreadable. Same trick the existing `--warning-text` token uses elsewhere in the file.

### Verify Feature C locally

Open the Entities tab (after connecting a vault if one isn't already connected):
- Each entity card's left dot is colored by its type, not by vibrance
- Pinned/peak entities show a colored halo around the dot
- Aged and old entities fade to lower opacity but keep their type color
- Switching theme to dark keeps every dot visible

Open the Activity tab:
- Source icons (PDF / EML / DOC / TXT / AUD badges) read as saturated landing-page hues
- Text remains legible on each tinted background

### Commit 3

```
git add styles.css src/app.js
git commit -m "Color entity dot by type, polychrome activity source icons"
```

---

## After all three commits

1. Run `npm test` (or whatever the project's test command is — check `package.json`). Confirm tests pass.
2. Run `git log --oneline polychrome-pass ^main` and confirm exactly three commits, in the order above.
3. **Stop here. Report back to Connor.** Do not push the branch. Do not open a PR.

Tell Connor in the reply:
- Which file ranges changed (one line per file)
- Whether tests pass
- Anything you had to deviate from the prompt and why (especially the entity-type field name resolved at Edit 6)
- Any visual concern you noticed during local verification

After Connor confirms the local check passed, push the branch with `git push -u origin polychrome-pass` and open a PR titled `Polychrome pass — colored nav, drop-zone art, type dots`. Use this body:

```
Three commits in one PR:

1. Polychrome tokens + colored nav icons (vermillion / cobalt / mustard for Activity / Entities / Files).
2. Kandinsky composition behind drop zone, half-opacity at rest, waking on hover/drag. Resolves DESIGN-NOTES.md note about keeping Kandinsky in the inbox.
3. Entity dot color-by-type (vibrance demoted to halo); activity source icons saturated to landing-page polychrome.

Chrome stays calm: sidebar background, advanced panel, document editor, and the existing --accent token are untouched. Graph palette is a separate PR.

Test plan:
- [ ] Tab icons each take their own color in light + dark
- [ ] Drop zone painting at rest is quiet, wakes on hover/drag, doesn't block the headline
- [ ] Entity dots vary by type; pinned entities show halo; aged entities fade
- [ ] Source icons saturated and legible
- [ ] No regressions in existing test suite
```

## Hard constraints

- Do not modify the existing `--accent` token. Do not modify `.brand-dot`. Do not touch the graph palette tokens (`--graph-node-*`).
- Do not push to `main`. Ever.
- Do not skip the local verification step.
- If any file's structure has drifted from the line-number hints above, anchor on the selector text and the surrounding code. Do not blindly insert at a line number.
- If the entity type field name in `src/app.js` is unclear, stop and ask Connor.
- Do not run `git push --force` or any destructive git operation.
- Do not open a PR until Connor approves after local test.
