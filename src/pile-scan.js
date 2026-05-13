// Pile scan: turn a folder of unsorted raw files into a priority-ranked queue
// Claude can compile first. Pure compute, no LLM. Runs in ~1-2s on 250 files.
//
// Output is consumed by margins_start in pile mode. Claude reads the
// priorityQueue, calls propose_compile_from_raw on each entry in parallel,
// and the user has 5 staged source pages within ~90 seconds of `Help me with
// my pile.`
//
// Scoring (all per-file scores normalized to [0,1] within the candidate set):
//   final = 0.30*sizeRank + 0.30*mtimeRank + 0.20*filenameQual + 0.20*entityOverlap
//
// Files dropped from the candidate set:
//   - Near-empty (under MIN_CONTENT_BYTES)
//   - Duplicate (same normalized content hash as another file)
//   - Already compiled (a wiki/sources/source-<slug>.md exists in the vault)

import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const MAX_SCAN_BYTES = 50_000;
const MIN_CONTENT_BYTES = 100;

const TEXT_EXTS = new Set([".md", ".markdown", ".txt"]);

// Recurring proper-noun candidates — single capitalized words, 3+ chars.
// Stopwords keep sentence-openers, months, days, common verbs out. Same list
// as before, kept small. This extraction was overcooked as a Claude-facing
// output (Codex was right to call it). It's load-bearing here because we use
// it to SCORE files, not to surface entities to the model.
const CAPITALIZED_RE = /\b[A-Z][a-z]{2,}\b/g;

const STOPWORDS = new Set([
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
  "Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug", "Sep", "Sept", "Oct", "Nov", "Dec",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
  "The", "This", "That", "These", "Those", "When", "Where", "What", "How",
  "Why", "Who", "Which", "And", "But", "Or", "If", "Also", "So", "Then",
  "Now", "Today", "Tomorrow", "Yesterday", "There", "Here", "Some", "Any",
  "All", "Many", "Most", "More", "Less", "First", "Second", "Third",
  "You", "Your", "Yours", "Our", "Their", "His", "Her", "Hers",
  "Just", "Maybe", "Probably", "Definitely", "Actually", "Really", "Very",
  "Like", "Want", "Need", "Going", "Make", "Made", "Take", "Took",
  "Get", "Got", "Have", "Had", "Will", "Would", "Could", "Should", "Might",
  "Talked", "Met", "Saw", "Sent", "Wrote", "Read", "Called", "Texted",
  "Emailed", "Asked", "Said", "Told", "Heard", "Thought", "Felt", "Tried",
  "Decided", "Realized", "Noticed", "Started", "Stopped", "Worked", "Walked",
  "Drove", "Ran", "Spent", "Spoke", "Came", "Went", "Found", "Discussed",
  "Reviewed", "Followed", "Reached", "Mentioned", "Suggested", "Planned",
  "Random", "About", "Around", "After", "Before", "During", "Through",
  "Without", "Within", "Until", "Since", "While", "Although", "Though",
  "TODO", "Note", "Notes", "FIXME", "TBD", "WIP"
]);

export async function scanRawForCompile(vault, options = {}) {
  const rawDirRel = options.rawDir ?? "raw";
  const topN = options.topN ?? 5;
  const rawDir = vault.resolveInside(rawDirRel);

  let entries;
  try {
    entries = await readdir(rawDir, { withFileTypes: true });
  } catch {
    return emptyScan(rawDirRel);
  }

  const rawFiles = entries
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((name) => !name.startsWith("."))
    .filter((name) => TEXT_EXTS.has(path.extname(name).toLowerCase()));

  if (!rawFiles.length) return emptyScan(rawDirRel);

  const alreadyCompiled = await collectCompiledSlugs(vault);

  const records = [];
  for (const name of rawFiles) {
    const abs = path.join(rawDir, name);
    let info;
    try { info = await stat(abs); } catch { continue; }
    let body;
    try { body = await readFile(abs, "utf8"); } catch { body = ""; }
    const truncated = body.slice(0, MAX_SCAN_BYTES);
    const hash = contentHash(truncated);
    const slug = path.basename(name, path.extname(name));
    records.push({
      name,
      relPath: `${rawDirRel}/${name}`,
      mtimeMs: info.mtimeMs,
      size: info.size,
      sampledBytes: truncated.length,
      content: truncated,
      hash,
      slug,
      isCompiled: alreadyCompiled.has(slug)
    });
  }

  // Duplicate detection: any hash that appears >1x is a duplicate group.
  const byHash = new Map();
  for (const r of records) {
    if (!byHash.has(r.hash)) byHash.set(r.hash, []);
    byHash.get(r.hash).push(r);
  }
  const duplicateGroups = [...byHash.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      hash: group[0].hash,
      count: group.length,
      paths: group.map((r) => r.relPath)
    }));
  const dupKeepers = new Set();
  for (const [, group] of byHash) {
    if (group.length === 1) {
      dupKeepers.add(group[0].relPath);
    } else {
      // Keep the oldest; the duplicates' relPaths are surfaced in duplicateGroups.
      const oldest = [...group].sort((a, b) => a.mtimeMs - b.mtimeMs)[0];
      dupKeepers.add(oldest.relPath);
    }
  }

  const likelyEmpty = records
    .filter((r) => r.size < MIN_CONTENT_BYTES)
    .map((r) => r.relPath);

  // Entity-frequency map across the whole pile. Used to score "interconnect"
  // — a file that mentions multiple recurring names is more useful to compile
  // first because its source page will already link into the rest of the pile.
  const tokenFreq = new Map();
  for (const r of records) {
    const matches = r.content.match(CAPITALIZED_RE) || [];
    const seenInFile = new Set();
    for (const m of matches) {
      if (STOPWORDS.has(m)) continue;
      if (seenInFile.has(m)) continue;
      seenInFile.add(m);
      tokenFreq.set(m, (tokenFreq.get(m) || 0) + 1);
    }
  }
  // A "recurring" token appears in >=2 raw files.
  const recurring = new Set(
    [...tokenFreq.entries()].filter(([, count]) => count >= 2).map(([k]) => k)
  );

  // Build the candidate set: not duplicate-skip, not empty, not already compiled.
  const candidates = records.filter(
    (r) =>
      dupKeepers.has(r.relPath) &&
      r.size >= MIN_CONTENT_BYTES &&
      !r.isCompiled
  );

  if (!candidates.length) {
    return {
      rawDir: rawDirRel,
      totalRawFiles: rawFiles.length,
      uncompiledCount: candidates.length,
      alreadyCompiledCount: records.filter((r) => r.isCompiled).length,
      duplicateGroups,
      likelyEmpty,
      detectedPrefixes: detectPrefixes(rawFiles),
      priorityQueue: []
    };
  }

  // Rank inputs across the candidate set.
  const sizes = candidates.map((r) => Math.min(r.size, MAX_SCAN_BYTES));
  const mtimes = candidates.map((r) => r.mtimeMs);
  const minSize = Math.min(...sizes), maxSize = Math.max(...sizes);
  const minMtime = Math.min(...mtimes), maxMtime = Math.max(...mtimes);

  const scored = candidates.map((r) => {
    const sizeRank = normalize(Math.min(r.size, MAX_SCAN_BYTES), minSize, maxSize);
    const mtimeRank = normalize(r.mtimeMs, minMtime, maxMtime);
    const filenameQual = filenameQuality(r.name);
    const fileTokens = new Set(
      (r.content.match(CAPITALIZED_RE) || []).filter((m) => recurring.has(m))
    );
    const entityOverlap = recurring.size > 0
      ? Math.min(1, fileTokens.size / 6)   // 6 cross-referenced entities = max signal
      : 0;
    const score = 0.30 * sizeRank + 0.30 * mtimeRank + 0.20 * filenameQual + 0.20 * entityOverlap;
    return {
      path: r.relPath,
      size: r.size,
      mtimeMs: r.mtimeMs,
      score: Math.round(score * 100) / 100,
      reason: buildReason({
        size: r.size,
        mtimeMs: r.mtimeMs,
        filenameQual,
        entityCount: fileTokens.size,
        sampleEntities: [...fileTokens].slice(0, 3)
      })
    };
  });

  scored.sort((a, b) => b.score - a.score || b.mtimeMs - a.mtimeMs);

  return {
    rawDir: rawDirRel,
    totalRawFiles: rawFiles.length,
    uncompiledCount: candidates.length,
    alreadyCompiledCount: records.filter((r) => r.isCompiled).length,
    duplicateGroups,
    likelyEmpty,
    detectedPrefixes: detectPrefixes(rawFiles),
    priorityQueue: scored.slice(0, topN)
  };
}

function emptyScan(rawDir) {
  return {
    rawDir,
    totalRawFiles: 0,
    uncompiledCount: 0,
    alreadyCompiledCount: 0,
    duplicateGroups: [],
    likelyEmpty: [],
    detectedPrefixes: [],
    priorityQueue: []
  };
}

async function collectCompiledSlugs(vault) {
  const compiled = new Set();
  try {
    const allFiles = await vault.listFiles();
    for (const abs of allFiles) {
      const base = path.basename(abs, path.extname(abs));
      if (base.startsWith("source-")) compiled.add(base.slice("source-".length));
    }
  } catch {
    // empty vault is fine
  }
  return compiled;
}

function contentHash(body) {
  // Normalize whitespace and case so cosmetic edits aren't treated as new content.
  const normalized = body.replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}

function normalize(val, min, max) {
  if (max === min) return 1;
  return (val - min) / (max - min);
}

function filenameQuality(name) {
  // 1.0 — free-form (looks like a real title)
  // 0.7 — dated (YYYY-MM-DD)
  // 0.5 — meeting/journal/source prefix
  // 0.4 — numbered
  // 0.2 — Untitled / Document (N) / generic dump
  // 0.1 — anonymous fragment
  const base = name.replace(/\.(md|markdown|txt)$/i, "");
  if (/^(Untitled|Document[ _]?\(?\d+\)?|Note[ _]\d+|New[ _]Note|new[ _]file)/i.test(base)) {
    return 0.2;
  }
  if (/^\d+$/.test(base)) return 0.4;
  if (/^\d{4}-\d{2}-\d{2}/.test(base)) return 0.7;
  if (/^([a-z]+)[-_]/i.test(base) && base.length > 8) return 0.85;
  if (base.length < 4) return 0.1;
  return 1.0;
}

function buildReason({ size, mtimeMs, filenameQual, entityCount, sampleEntities }) {
  const sizeBlurb =
    size > 8_000 ? `${(size / 1024).toFixed(0)}KB` : `${size}b`;
  const ageBlurb = ageLabel(mtimeMs);
  const parts = [sizeBlurb, ageBlurb];
  if (filenameQual >= 0.7) parts.push("named");
  if (entityCount > 0) {
    parts.push(`mentions ${sampleEntities.join(", ")}${entityCount > sampleEntities.length ? " +more" : ""}`);
  }
  return parts.join(", ");
}

function ageLabel(mtimeMs) {
  const days = (Date.now() - mtimeMs) / (1000 * 60 * 60 * 24);
  if (days < 2) return "today/yesterday";
  if (days < 8) return `${Math.round(days)}d old`;
  if (days < 32) return `${Math.round(days / 7)}w old`;
  if (days < 366) return `${Math.round(days / 30)}mo old`;
  return `${Math.round(days / 365)}y old`;
}

export function detectPrefixes(filenames) {
  const counts = new Map();
  for (const f of filenames) {
    const base = f.replace(/\.(md|markdown|txt)$/i, "");
    const m = base.match(/^([a-z][a-z0-9]+)[-_]/i);
    if (!m) continue;
    const prefix = m[1].toLowerCase();
    if (!counts.has(prefix)) counts.set(prefix, []);
    counts.get(prefix).push(f);
  }
  return [...counts.entries()]
    .filter(([, files]) => files.length >= 3)
    .map(([prefix, files]) => ({
      prefix,
      count: files.length,
      examples: files.slice(0, 3)
    }))
    .sort((a, b) => b.count - a.count);
}
