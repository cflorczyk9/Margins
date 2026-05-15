# 30-second demo video — recording brief

This is the script + recording spec for the demo video that gets embedded in
the README hero, on margins.app, and in the r/ObsidianMD post. The brief is
short on purpose. Aim to record this in one take if possible — the unedited
feel is the point.

## Goal

Show a person who has never seen Margins exactly what changes for them after
they install it. The single magical moment: Claude calling tools and citing
real files. 30 seconds, capped at 45.

## Recording setup

- **Tool:** macOS built-in screen recording (`Cmd-Shift-5`) or [CleanShot
  X](https://cleanshot.com/) for cleaner cursor + click highlights.
- **Resolution:** 1280×720 minimum, 1920×1080 ideal. Crop to a tight window
  later if needed.
- **Audio:** none. The video should work as a silent loop on the README.
- **Cursor:** show the cursor. Don't hide it.
- **Windows visible:** just Claude Desktop. Hide other apps, clean dock,
  hide menu bar items if possible.
- **Vault to use:** your real connor_brain2 vault. The realness sells it.
  If you'd rather not show real personal names, use a stripped-down copy
  with 50-100 dummy notes — but real is better.

## Shot list

| t       | what's on screen                                              |
|---------|---------------------------------------------------------------|
| 0:00    | Claude Desktop, new chat, cursor in the input                 |
| 0:01    | You start typing                                              |
| 0:04    | You finish typing — see prompt below                          |
| 0:05    | You hit return                                                |
| 0:06    | "Loaded tools, used margins integration" collapsible appears  |
| 0:09    | Claude's response starts streaming with citations             |
| 0:18    | Response complete; specific file paths visible                |
| 0:23    | Cursor hovers over one cited path                             |
| 0:30    | Final frame — hold for 2 seconds                              |

## The exact prompt to type

```
Use margins to give me the three things I should care about from this week,
with the file paths that support each.
```

That phrasing forces Claude to: call `margins_start`, call `list_recent`,
read a couple of pages, then return three claims each cited with a specific
`wiki/.../foo.md` path. Forcing the citations is the whole point.

## Why this prompt and not others

- "Summarize my notes" — too generic; Claude might return a vibey paragraph
  without citations.
- "What did I do this week" — same problem.
- "Find pages about X" — requires the viewer to know X.

This prompt is **declarative** ("three things"), **structured** (citations
forced), and **personal** (this week). Three of the things that make the
output feel like Claude actually knows the user.

## Post-processing

- Trim to 30s (45s max).
- Export as **MP4 (H.264)** at ~5 Mbps. Should be under 3 MB.
- Also export an **animated WebP** or **GIF** (under 5 MB) for the README
  hero — GitHub renders animated WebP/GIF inline in markdown.
- Save both as:
  - `web/demo.mp4`
  - `web/demo.webp`

## Where the assets land

1. **README hero**, replacing the (currently deleted) placeholder:
   ```markdown
   ![Margins demo — Claude reading and citing files from your vault](web/demo.webp)
   ```
2. **margins.app**: drop a `<video autoplay muted loop playsinline>` into the
   hero or just below it. The dark logo mark stays in the hero; the demo lives
   under the hero, not replacing it.
3. **r/ObsidianMD post**: upload the GIF/WebP directly. Reddit renders it
   inline.
4. **Twitter/X**: MP4 attached. Caption: "Use your Claude Pro subscription
   on your Obsidian vault. 30 seconds, no API key."

## What NOT to show

- The terminal install. That's a separate "how to install" asset if you
  want one later. The demo is about the magic moment, not the setup.
- Tool internals or JSON output. The collapsible is enough signal.
- Multi-vault picker, persona classification, preferences. Each of those
  is a separate 15-second clip if you want a follow-up reel. For the first
  demo, one shot, one magical moment.

## Acceptance criteria

A friend who has never heard of Margins watches the video once and can
answer all three:

1. What does it do? *Reads my notes and answers questions about them.*
2. Who runs the AI? *Claude.*
3. Where do my files live? *Stayed on my computer.*

If the video doesn't answer those three things implicitly, re-shoot.

## Stretch

If 30s feels too sparse: a 5-second pre-roll showing the
`curl -fsSL margins.app/install | bash` command in a terminal, then cut
to Claude Desktop. Adds the "this was one command" anchor before the magic
moment.
