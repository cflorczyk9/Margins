// Entity stub builder + rejection memory.
//
// Consumes the candidate list from scan_entity_candidates and stages one
// stub page per candidate at wiki/<bucket>/<slug>.md (default
// bucket=entities). Each stub is marked with `from_scan: true` so the
// resolve_proposal flow can detect reject events and append the slug to
// .margins/entity-rejections.md. The next scan_entity_candidates call
// reads that file (auto-wired in server.js) and excludes rejected slugs
// so the user doesn't see the same candidate again.
//
// Two-tool architecture: scan returns suggestions, stubs stages them.
// User filters in between. This is a deliberate split — staging directly
// from scan would land a wall of stubs the user has to wade through.
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter, getType } from "./frontmatter.js";

const REJECTIONS_REL = ".margins/entity-rejections.md";
const REJECTIONS_HEADER = `# Entity rejections

Slugs the user has rejected via propose_entity_stubs. scan_entity_candidates
reads this and excludes these candidates by default so rejected suggestions
don't re-surface scan after scan.

Format: one slug per bullet under a dated heading. Hand-editable — delete
a bullet to let a slug surface again next scan.

`;

// Marker we drop into stub frontmatter so resolve_proposal can detect
// reject events on entity stubs without scanning every proposed file.
export const ENTITY_STUB_MARKER = "from_scan";

export function createEntityStubs(vault, proposals) {
  async function proposeEntityStubs(candidates, options = {}) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new Error("`candidates` must be a non-empty array of slugs or candidate objects.");
    }
    const bucket = String(options.bucket || "entities").replace(/^\.?\/+|\/+$/g, "");
    if (bucket.includes("..")) throw new Error("bucket cannot contain '..'");
    const normalized = candidates.map(normalizeCandidate);

    const results = [];
    for (const cand of normalized) {
      const destPath = `wiki/${bucket}/${cand.slug}.md`;
      const body = buildStubBody(cand);
      // force=true: if a stub for this slug already exists in the vault
      // (e.g., from a prior scan the user accepted), overwriting it would
      // be aggressive. Instead, skip and report. Only stage when the
      // destination is genuinely new.
      const existingAbs = vault.resolveInside(destPath);
      const exists = await pathExists(existingAbs);
      if (exists) {
        results.push({
          slug: cand.slug,
          destinationPath: destPath,
          status: "exists",
          message: `Skipped — ${destPath} already exists. Edit the existing page rather than stubbing again.`
        });
        continue;
      }
      try {
        const r = await proposals.proposePage(destPath, body);
        results.push({
          slug: cand.slug,
          destinationPath: r.destinationPath,
          proposalPath: r.proposalPath,
          status: "staged"
        });
      } catch (err) {
        results.push({
          slug: cand.slug,
          destinationPath: destPath,
          status: "error",
          error: err.message
        });
      }
    }
    const staged = results.filter((r) => r.status === "staged").length;
    const skipped = results.filter((r) => r.status === "exists").length;
    const errored = results.filter((r) => r.status === "error").length;
    return {
      bucket,
      total: results.length,
      staged,
      skipped,
      errored,
      results
    };
  }

  return { proposeEntityStubs };
}

function normalizeCandidate(c) {
  if (typeof c === "string") {
    const slug = slugify(c);
    if (!slug) throw new Error(`invalid candidate slug: '${c}'`);
    return { slug, phrase: phraseFromSlug(slug), snippets: [], files: [] };
  }
  if (!c || typeof c !== "object") {
    throw new Error(`invalid candidate: ${JSON.stringify(c)}`);
  }
  const slug = slugify(c.slug || c.phrase || "");
  if (!slug) throw new Error(`candidate missing slug/phrase: ${JSON.stringify(c)}`);
  return {
    slug,
    phrase: c.phrase || phraseFromSlug(slug),
    mentionCount: c.mentionCount,
    fileCount: c.fileCount,
    snippets: Array.isArray(c.snippets) ? c.snippets : [],
    files: Array.isArray(c.files) ? c.files : []
  };
}

function phraseFromSlug(slug) {
  return slug.split("-").map((p) => p ? p[0].toUpperCase() + p.slice(1) : p).join(" ");
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function yamlString(s) {
  if (typeof s !== "string") return `"${String(s)}"`;
  if (/[:#\n\r"']/.test(s)) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}

function buildStubBody(cand) {
  const fmLines = [
    "---",
    "type: entity",
    `title: ${yamlString(cand.phrase)}`,
    `slug: ${cand.slug}`,
    `${ENTITY_STUB_MARKER}: true`
  ];
  if (typeof cand.mentionCount === "number") fmLines.push(`mention_count_at_scan: ${cand.mentionCount}`);
  if (typeof cand.fileCount === "number") fmLines.push(`file_count_at_scan: ${cand.fileCount}`);
  fmLines.push("voice: claude-draft");
  fmLines.push("---");

  const intro = (typeof cand.mentionCount === "number" && typeof cand.fileCount === "number")
    ? `Stub created by \`scan_entity_candidates\` — appeared ${cand.mentionCount}× across ${cand.fileCount} file${cand.fileCount === 1 ? "" : "s"} at scan time.`
    : "Stub created by `scan_entity_candidates`.";

  const mentions = [];
  if (cand.snippets.length) {
    mentions.push("## Mentioned in");
    mentions.push("");
    for (const s of cand.snippets) {
      const linkTarget = s.file ? toWikilinkSlug(s.file) : null;
      const lead = linkTarget ? `[[${linkTarget}]]` : "(file missing)";
      mentions.push(`- ${lead} — ${s.snippet || ""}`);
    }
  } else if (cand.files.length) {
    mentions.push("## Mentioned in");
    mentions.push("");
    for (const f of cand.files) {
      mentions.push(`- [[${toWikilinkSlug(f)}]]`);
    }
  }

  const next = [
    "## Next",
    "",
    "- Replace this stub body with real content the user wrote.",
    "- Wikilink related concepts.",
    "- Rename the slug if a more canonical form exists."
  ];

  const sections = [`# ${cand.phrase}`, "", intro];
  if (mentions.length) {
    sections.push("");
    sections.push(...mentions);
  }
  sections.push("");
  sections.push(...next);

  return `${fmLines.join("\n")}\n\n${sections.join("\n")}\n`;
}

function toWikilinkSlug(filePath) {
  return String(filePath || "")
    .split("/").pop()
    .replace(/\.md$/i, "");
}

async function pathExists(abs) {
  try { await stat(abs); return true; }
  catch { return false; }
}

// --- Rejection memory ---

export async function readEntityRejections(vault) {
  const abs = vault.resolveInside(REJECTIONS_REL);
  let body;
  try { body = await readFile(abs, "utf8"); }
  catch { return []; }
  const slugs = new Set();
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^-\s+([a-z0-9][a-z0-9-]*)\s*$/);
    if (m) slugs.add(m[1]);
  }
  return Array.from(slugs);
}

export async function recordEntityRejection(vault, slug) {
  const cleanSlug = slugify(slug);
  if (!cleanSlug) return { recorded: false, reason: "invalid-slug" };
  const abs = vault.resolveInside(REJECTIONS_REL);
  let body;
  try { body = await readFile(abs, "utf8"); }
  catch { body = REJECTIONS_HEADER; }

  // Already recorded? Skip — keep file dedup'd.
  const existing = await readEntityRejections(vault);
  if (existing.includes(cleanSlug)) {
    return { recorded: false, reason: "already-rejected", slug: cleanSlug };
  }

  const today = new Date().toISOString().slice(0, 10);
  const heading = `## ${today}`;
  const bullet = `- ${cleanSlug}`;
  if (body.includes(`\n${heading}\n`) || body.startsWith(`${heading}\n`)) {
    body = body.replace(
      new RegExp(`(${escapeRegExp(heading)}\\n[\\s\\S]*?)(?=\\n## |$)`),
      (match) => `${match.trimEnd()}\n${bullet}\n`
    );
  } else {
    body = body.trimEnd() + `\n\n${heading}\n${bullet}\n`;
  }

  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body, "utf8");
  return { recorded: true, slug: cleanSlug, path: REJECTIONS_REL };
}

// Inspect a proposal body and return its slug iff it's an entity stub
// staged by propose_entity_stubs. Used by the resolve_proposal wrapper to
// record rejections without scanning every proposal type.
export async function maybeReadEntityStubSlug(vault, destPath) {
  const proposedAbs = vault.resolveInside(`proposed/${destPath}`);
  let body;
  try { body = await readFile(proposedAbs, "utf8"); }
  catch { return null; }
  let parsed;
  try { parsed = parseFrontmatter(body); }
  catch { return null; }
  if (!parsed) return null;
  if (getType(parsed.data) !== "entity") return null;
  const marker = parsed.data[ENTITY_STUB_MARKER];
  if (marker !== true && String(marker).toLowerCase() !== "true") return null;
  const slug = parsed.data.slug;
  if (typeof slug !== "string" || !slug.length) return null;
  return slug;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
