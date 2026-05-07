# Polychrome plan

What Connor liked from the Bauhaus prototype, mapped to the actual Margins repo.

Scope: the three moves below. Chrome (sidebar background, advanced panel, document editor) stays calm. This is paint, not a redesign.

## Three wins to bring back

1. **Colored nav icons** — each sidebar tab tinted its own color (Activity vermillion, Entities cobalt, Files mustard).
2. **Kandinsky composition in the drop zone** — yellow disk + cobalt arc + ink triangle + scattered dots, behind the existing dashed-frame drop area.
3. **Polychrome dots on entity + activity cards** — type-colored at-a-glance, replacing the current single-terracotta system.

---

## Move 1 — Promote four colors to first-class tokens

**File:** `styles.css` lines 1-41 (the `:root, [data-theme="light"]` block).

The current tokens already exist (`--blue`, `--purple`, `--amber`, `--green`) but are desaturated cousins of the landing-page palette. Saturate them and add the missing two so the whole app shares one polychrome system.

**Add to the `:root` block:**

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

**In `[data-theme="dark"]`** (line 43-70), match with slightly desaturated versions for legibility on dark:

```css
--vermillion: #ee5b4f;
--cobalt:     #6f9bdf;
--mustard:    #ecbf66;
--violet:     #aa8ad4;
--green-poly: #82c479;
--tab-activity: var(--vermillion);
--tab-entities: var(--cobalt);
--tab-files:    var(--mustard);
```

Don't touch `--accent` yet — that change ripples through the whole app and is its own PR.

---

## Move 2 — Tint nav icons per tab

**File:** `index.html` lines 19-45 (the three `.tab` buttons).

The existing SVG icons use `stroke="currentColor"`, so changing the tab's text color recolors the icon for free. No HTML edit needed.

**Add to `styles.css` near the `.nav .tab` block (around line 3850):**

```css
.nav .tab[data-view="inbox"]    { --tab-color: var(--tab-activity); }
.nav .tab[data-view="entities"] { --tab-color: var(--tab-entities); }
.nav .tab[data-view="wiki"]     { --tab-color: var(--tab-files); }

.nav .tab svg {
  color: var(--tab-color, var(--muted));
  transition: color 160ms ease, transform 200ms cubic-bezier(0.16,1,0.3,1);
}

.nav .tab:hover svg { transform: scale(1.08); }

.nav .tab.active {
  background: color-mix(in srgb, var(--tab-color) 12%, transparent);
}
.nav .tab.active svg { color: var(--tab-color); }
.nav .tab.active span { color: var(--ink); }
```

This is the single biggest visual upgrade in the app. The sidebar goes from "one accent everywhere" to "three distinct destinations" the eye can track. Minutes of work.

---

## Move 3 — Kandinsky composition behind the drop zone

**File:** `styles.css` lines 1488-1534 (the override `.inbox-drop` + `.drop-mark`).

Resolution to the design-note contradiction (DESIGN-NOTES.md:16 says keep Kandinsky in the inbox; the Claude-parity PRs deleted it). Keep the calm dashed-frame outer container; restore the painting *inside* it as a positioned SVG.

**Add an SVG to the existing markup at `index.html:140-155`:**

```html
<section id="source-drop-zone" class="source-drop-zone inbox-drop" role="button" tabindex="0" aria-label="Choose files or drag them into Margins">
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
  <div class="drop-mark" aria-hidden="true"></div>
  <h3>Drag and drop here</h3>
  <p>or click to browse</p>
  <!-- existing drop-formats + drop-actions stay -->
</section>
```

**Add CSS:**

```css
.inbox-drop { position: relative; }

.drop-art {
  position: absolute;
  inset: 0;
  width: 100%; height: 100%;
  opacity: 0.5;
  pointer-events: none;
  z-index: 0;
}

.inbox-drop > *:not(.drop-art) { position: relative; z-index: 1; }

.inbox-drop:hover .drop-art,
.inbox-drop.dragging .drop-art { opacity: 0.85; transition: opacity 360ms ease; }
```

The 0.5 base opacity keeps the painting quiet so the headline + button stay legible. Hover/drag bumps it to 0.85 — the painting wakes up when you engage with the drop zone. The motion suits "the painting grows as you ingest."

You could also replace the small `.drop-mark` (lines 1505-1534, currently a thin upload-arrow built from pseudo-elements) with the concentric Kandinsky disk from the original first definition (lines 561-570). Optional second pass if you want the mark itself to also carry the brand.

---

## Move 4 — Type-colored entity dots

**File:** `styles.css` lines 4335-4363 (the `.entity-vibe` block) plus the render at `src/app.js:8085`.

The card already has a 7px dot in `.entity-card-top` colored by **vibrance** (peak/fresh/recent/aged/old) — all five colors are warm-terracotta gradations of the same hue. Connor wants it to vary by **type** instead.

Two options:

### Option A — Type drives color, vibrance drives the ring

This preserves the heat signal Connor invested in (the regions script feeds it):

```css
.entity-vibe {
  width: 9px; height: 9px;
  border-radius: 50%;
  background: var(--ink-poly);
  flex: 0 0 auto;
  position: relative;
  transition: box-shadow 200ms ease;
}

/* Color by type — class added by render */
.entity-vibe.t-person  { background: var(--vermillion); }
.entity-vibe.t-project { background: var(--green-poly); }
.entity-vibe.t-company { background: var(--cobalt); }
.entity-vibe.t-concept { background: var(--violet); }
.entity-vibe.t-source  { background: var(--mustard); }
.entity-vibe.t-school  { background: var(--mustard); }
.entity-vibe.t-tool    { background: var(--violet); }

/* Vibrance becomes the halo around the dot */
.entity-vibe.peak   { box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 30%, transparent); }
.entity-vibe.fresh  { box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 22%, transparent); }
.entity-vibe.recent { /* no halo */ }
.entity-vibe.aged   { opacity: 0.6; }
.entity-vibe.old    { opacity: 0.4; }
```

**Render change at `src/app.js:8085`:**

```js
<span class="entity-vibe ${escapeHtml(entityVibeClass(record))} t-${escapeHtml(record.type || "concept")}"></span>
```

Confirm `record.type` (or whatever the type field is on the entity record) maps to one of the values above. If the field is `record.entityType` or similar, swap accordingly.

### Option B — Two dots side by side

If you prefer keeping vibrance and type as separate visual signals, render `.entity-vibe` (vibrance) and `.entity-type-dot` (type) as two adjacent dots. Less elegant but more information density.

I'd ship Option A. Halos are subtle; the polychrome wins.

### Pinned entities get the concentric mark

For pinned entities (Connor's pinned tier), upgrade the dot from solid to concentric so they read as load-bearing at a glance:

```css
.entity-card.is-pinned .entity-vibe {
  width: 14px; height: 14px;
  background:
    radial-gradient(circle at 50% 50%, var(--ink-poly) 0 1.5px, transparent 1.5px),
    radial-gradient(circle at 50% 50%, currentColor 0 4px, transparent 4.5px),
    var(--mustard);
  color: var(--vermillion); /* the middle ring */
}
```

---

## Move 5 — Polychrome the activity-card source icons

**File:** `styles.css` lines 4659-4697 (`.source-icon` and its type variants).

Each activity card already has a colored badge per file format (pdf/eml/doc/txt/aud). The colors exist, they're just desaturated. Bump them to landing-page saturation in one pass:

```css
.source-icon.pdf { background: color-mix(in srgb, var(--vermillion) 14%, transparent); color: var(--vermillion); }
.source-icon.eml { background: color-mix(in srgb, var(--green-poly) 16%, transparent); color: var(--green-poly); }
.source-icon.doc { background: color-mix(in srgb, var(--cobalt) 14%, transparent);     color: var(--cobalt); }
.source-icon.txt { background: color-mix(in srgb, var(--violet) 14%, transparent);     color: var(--violet); }
.source-icon.aud { background: color-mix(in srgb, var(--mustard) 18%, transparent);    color: #8d5f00; }
```

Mustard text on mustard tint is unreadable, hence the `#8d5f00` body. Same trick the existing `--warning-text` token uses.

---

## What I'd ship in what order

1. **Move 1 + Move 2** as one PR. Tokens + nav-icon tinting. ~30 lines of CSS, zero HTML risk, biggest perceptible change. Land first.
2. **Move 5** as one PR. Source-icon polychrome. ~10 lines of CSS. Trivial.
3. **Move 4** as one PR. Type-colored entity dots. Requires confirming `record.type` field name in `src/app.js`. Small JS edit.
4. **Move 3** as the last PR. Drop-zone composition. Requires the `index.html` markup change plus CSS. Resolves the DESIGN-NOTES contradiction so include a note in DESIGN-NOTES.md saying the Kandinsky language is back inside the calm frame.

Each PR is under ~50 lines of diff. None of them touch app behavior.

## What I'm explicitly not touching

- The graph palette (separate concern, its own PR — `styles.css:3340-3344`)
- Document editor reading surface (stays plain on purpose)
- Sidebar background, advanced panel, vault card chrome (stays calm)
- The existing `--accent` token (single-color rippling change, do not bundle)
- Dark mode polish beyond the parallel token additions in Move 1

## Verification before each PR

- After Move 1+2: open the sidebar, confirm three tab icons each take their own color and the active state shows the colored tint behind the icon without changing the label color.
- After Move 5: scroll the activity wall in the inbox and confirm the badges are now saturated without losing readability.
- After Move 4: check `record.type` exists on entity records by logging one to the console; if the field name differs, adjust the render template accordingly.
- After Move 3: drag a file over the drop zone and verify the painting wakes up, not the other way around. If it dominates the headline at rest, drop the base opacity from 0.5 to 0.35.
