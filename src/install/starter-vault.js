import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const CLAUDE_MD = `# CLAUDE.md

This vault was scaffolded by margins-mcp.

## How to use it
- Drop raw transcripts, PDFs, Word docs, spreadsheets, decks, emails, EPUBs, or articles into \`raw/\`. Ask Claude to compile them with \`propose_compile_from_raw\`.
- Wiki pages live in \`wiki/\`. Sources, concepts, entities, syntheses, and your own structure are all welcome.
- Proposals (Claude's suggested writes) stage at \`proposed/\` before landing. Review them with \`list_proposals\` and \`resolve_proposal\`.
- Margins indexes everything under \`wiki/\` by default. Set \`MARGINS_INDEX_ROOTS\` to override.

## Closed-set vocabulary for the log
ingest | query | compile | lint | update
`;

const OPERATOR_MANUAL = `# Operator manual

This is the starter operator-manual. Margins assumes:

1. Raw files are evidence. They live under \`raw/\` and don't get edited.
2. Wiki pages are the navigable layer. They live under \`wiki/\` and get linked, tagged, summarized.
3. Proposed writes stay in \`proposed/\` until you accept them.
4. The model is a drafter, not an autonomous editor. Always review proposals before accepting.

When you ingest a new source, the typical flow is:
- \`propose_compile_from_raw\` to turn the raw file into a structured source page
- review, accept the source page
- ask Claude to update related entity / concept pages via \`propose_edit\` or \`append_to\`
- review, accept each one

You own the vault. Margins is just plumbing.
`;

const INDEX_MD = `# Index

This vault is fresh. Start by:
1. Dropping a markdown note into \`wiki/daily/\` to log today's events
2. Or ingesting a raw source: drop a file into \`raw/\`, then ask Claude to compile it
3. Or just asking Claude to summarize what's here once you have a few pages

When the vault grows, this index becomes your map. Add links to durable pages as they appear.
`;

const FOLDERS = ["wiki/daily", "wiki/sources", "wiki/entities", "wiki/concepts", "raw"];

const FILES = {
  "CLAUDE.md": CLAUDE_MD,
  "operator-manual.md": OPERATOR_MANUAL,
  "wiki/index.md": INDEX_MD
};

export async function scaffoldStarterVault(targetPath, { force = false } = {}) {
  let entries = [];
  try {
    entries = await readdir(targetPath);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const nonEmpty = entries.filter((e) => !e.startsWith("."));
  if (nonEmpty.length > 0 && !force) {
    throw new Error(
      `Target directory ${targetPath} is not empty (${nonEmpty.length} entries). ` +
        `Pass --force to scaffold anyway, or choose an empty path.`
    );
  }

  await mkdir(targetPath, { recursive: true });
  const written = [];
  for (const folder of FOLDERS) {
    await mkdir(path.join(targetPath, folder), { recursive: true });
  }
  for (const [rel, body] of Object.entries(FILES)) {
    const abs = path.join(targetPath, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, body, "utf8");
    written.push(rel);
  }
  return { path: targetPath, folders: FOLDERS, files: written };
}
