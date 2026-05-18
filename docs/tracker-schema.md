# Tracker schema and source-page types

This is the contract for what `wiki/ingest-tracker.md` reflects and which
frontmatter shapes participate in it. Codified at Checkpoint B of the cold-
start arc so the entity-scan / wikilinks phases inherit a fixed model.

## Page types

| `type:` | Triggers tracker row? | Counted as "filed" by raw-index? | Notes |
|---|---|---|---|
| `source` | yes | yes | Single-source compile. One raw file ↔ one source page ↔ one tracker row. |
| `source_segment` | **no** | **yes** | Segment of a split-mode compile. Tracker is updated for the segment's hub, not for each segment. |
| `synthesis` | no (today) | yes | Multi-source synthesis page. Counted as filed when it references raw files. |
| `hub` (informal) | — | — | Not a separate type — a hub is `type: source` with `is_hub: true`. Treated as `source` by all paths. |
| anything else | no | no | Concept/entity/log/index pages. Don't reference raw files. |

The split decision lives at [src/proposals.js](../src/proposals.js) (the
tracker writer keys on `type === "source"`) and at
[src/raw-index.js](../src/raw-index.js) (the index extends the "referenced"
set to include `source_segment`).

## Why hub-only tracker rows

For one raw file split into N segments, three contracts were considered:

1. **One row per segment.** Tracker grows by N rows per split call. Doctor
   gets per-segment status (each row can independently say "ingested",
   "stale", etc.). Cost: tracker bloats from one page per file to N. The
   row-match regex would need a compound key on (raw_file, segment_index).
2. **One row per hub only** (chosen). One raw file = one tracker row pointing
   to the hub. Per-segment status is folded into the doctor's hub-segment-
   mismatch check rather than living in the tracker. Tracker size stays
   roughly proportional to the number of raw files, not the number of
   wiki pages.
3. **One row per file plus an N-segment subtable.** Adds tracker schema
   complexity; defer until anyone needs it.

Going with (2) because (a) the tracker's job is "what raw files are filed,"
not "what every wiki page reflects," and (b) per-segment health is a
separate concern with its own doctor check.

## Frontmatter contract for split mode

Hub page (one per split):

```yaml
---
type: source
title: <raw file basename without extension>
raw_file: <vault-relative path to the raw file>
raw_sha256: <full sha256 of the raw file>
raw_size: <byte size>
segments_count: <N — how many segments were staged>
split_on: heading-h1 | heading-h2 | sheet
is_hub: true
voice: claude-draft
---
```

The hub body has a `## Segments` block listing each segment as a wikilink.
Tracker row gets the hub slug.

Segment page (N per split):

```yaml
---
type: source_segment
title: <segment heading>
raw_file: <same as hub>
raw_sha256: <same as hub>
raw_size: <same as hub>
segment_index: <0-based index>
segments_count: <N — same as hub>
hub: "[[<hub-slug>]]"
voice: claude-draft
---
```

Segment frontmatter must include `hub:` as a wikilink so the doctor can
walk from segment → hub for completeness checking.

## Implications for downstream phases

- **Entity scan** (next phase) should treat segments and source pages as
  equivalent for mention-counting — a candidate mentioned in 40 segments
  of one big document is as load-bearing as one mentioned in 40 standalone
  source pages.
- **Bulk wikilinks** should be safe to scope to `wiki/sources/source-*-s*`
  (segments) since their bodies are the same shape as a regular source
  page's body section.
- **Tracker writers in future tools** should remain off-by-default for
  `type: source_segment` — only `type: source` + raw_file: triggers a row.
  If a future tool needs to record a per-segment fact, add a side log,
  don't extend the tracker contract.

## Doctor checks that depend on this contract

| Check | What it asserts |
|---|---|
| `orphan-source` | `referenced[raw_file]` resolves to an existing file. Applies to both `source` and `source_segment` pages since both can reference a raw file. |
| `tracker-missing-row` | Every `source`-type page in the vault has a row in `wiki/ingest-tracker.md`. Skipped for `source_segment` pages by construction (they don't get rows). |
| `hub-segment-mismatch` | For every hub (`is_hub: true`), the number of segment pages with `hub: "[[<hub-slug>]]"` equals `segments_count`. Warns on either deficit or surplus. |
| `stale-source` | sha/size on a `source` or `source_segment` page matches the underlying raw file. Both shapes carry these fields by contract above. |

## Versioning note

This contract is added in v0.15.0 (cold-start arc). The `source_segment`
type is new. Vaults that predate v0.15.0 only contain `type: source`
pages, which continue to work unchanged through every path above.

## Known limitations in v0.15.0 (planned v0.16 fixes)

Two edge cases around `force=true` re-compiles leave the vault in a
state that `margins_doctor` can detect but Margins doesn't auto-clean.
Both fire only on user-triggered force operations and produce
doctor-detectable state — not silent corruption.

### force-split over an accepted single-source page

If a raw file already has a landed `type: source` page (from an earlier
single-source compile) and the user runs
`propose_compile_from_raw(split: ..., force: true)`, the split mode
stages a new hub + segments but does NOT remove the old single-source
page. After accepting the split, the vault contains both:

- `wiki/<bucket>/source-<base>.md` (the old single source)
- `wiki/<bucket>/<base>-hub.md` + N segments (the new split)

Both reference the same `raw_file`. raw-index's precedence walk prefers
the hub, so retrieval points at the new structure; the old page stays
as an orphan referencing the same raw.

**Workaround:** after accepting the split, manually delete the old
single-source page. Doctor will flag the duplicate as a tracker drift
warning so it's visible.

**v0.16 fix:** detect a landed non-hub source for the same raw_file
during the split pre-check and either refuse the operation with a clear
"delete the single-source first" error, or stage a removal proposal
that the user can accept to clear the old page.

### force re-split when segment slugs change

If a raw file already has an accepted split (hub + N segments in the
vault) and the user re-runs split with `force: true` after editing the
raw such that segment headings have changed, the new segment slugs
won't match the old slugs. `clearExistingSplit` only rejects PENDING
proposals tied to the raw; it does NOT touch landed segment files. The
user accepts the new staging; the old segment files remain in the vault
linking to the same hub (whose `segments_count` now mismatches).

**Workaround:** after accepting the new split, run `margins_doctor`.
The `hub-segment-mismatch` check surfaces the extra segments with
"Extra segments are linking to this hub" — manually delete those files.

**v0.16 fix:** enumerate landed segments under each hub before
re-splitting; stage replacement proposals at every old segment path
that doesn't map to a new segment slug (overwriting with an empty
marker or rewriting the hub link to remove the orphan). Either approach
needs a clearer "stage delete" primitive that v0.15.0 doesn't have.
