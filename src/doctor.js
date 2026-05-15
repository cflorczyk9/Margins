import { readFile, stat } from "node:fs/promises";
import { buildVaultIndex } from "./raw-index.js";
import { parseFrontmatter } from "./frontmatter.js";
import { hashFile } from "./hash.js";

const LARGE_RAW_THRESHOLD = 10 * 1024 * 1024;
const TRACKER_PATH = "wiki/ingest-tracker.md";
// Match a tracker row regardless of spaces or special characters in the raw
// filename. The path is "anything between '| ' and ' |' that contains a slash."
// `[^|\n]+?` is non-greedy and pipe-excluding so the column boundary is hard.
const TRACKER_ROW_RE = /^\|\s+([^|\n]+?\/[^|\n]+?)\s+\|\s+(\S+)\s+\|\s+\[\[([^\]]+)\]\]/;

/**
 * Diagnose a Margins vault. Returns a structured report of issues a user
 * (or Claude) can act on. Read-only: never modifies the vault.
 *
 * Issue kinds:
 *   - orphan-source       : source page references a raw_file that no longer exists
 *   - tracker-missing     : source page in vault but no row in ingest-tracker.md
 *   - tracker-orphan      : tracker row points to a slug that has no source page
 *   - parse-failure       : a file's frontmatter couldn't be parsed
 *   - large-raw           : raw file exceeds the LARGE_RAW_THRESHOLD
 */
export async function diagnoseVault(vault) {
  const index = await buildVaultIndex(vault);
  const issues = [];

  for (const [rawRel, sourcePage] of index.referenced) {
    try {
      await stat(vault.resolveInside(rawRel));
    } catch {
      issues.push({
        kind: "orphan-source",
        sourcePage,
        rawFile: rawRel,
        severity: "warn",
        message:
          `Source page ${sourcePage} references ${rawRel}, but that file no longer exists in the vault. ` +
          `The source page is now an orphan. Either restore the raw file, edit the source page's raw_file frontmatter, or delete the source page.`
      });
    }
  }

  for (const entry of index.parseFailures || []) {
    const rel = typeof entry === "string" ? entry : entry.path;
    const errDetail = typeof entry === "object" && entry.error ? ` (${entry.error})` : "";
    issues.push({
      kind: "parse-failure",
      path: rel,
      severity: "error",
      message:
        `Failed to parse frontmatter in ${rel}${errDetail}. Common cause: an unquoted YAML value containing a colon-space sequence (e.g., "summary: Key terms: ...") — wrap the value in double quotes. ` +
        `Margins's permissive fallback couldn't recover type/raw_file either, so the page is silently invisible to ingest detection until fixed.`
    });
  }

  for (const candidate of index.candidates) {
    let info;
    try {
      info = await stat(vault.resolveInside(candidate));
    } catch {
      continue;
    }
    if (info.size >= LARGE_RAW_THRESHOLD) {
      const mb = (info.size / 1024 / 1024).toFixed(1);
      issues.push({
        kind: "large-raw",
        path: candidate,
        size: info.size,
        severity: "info",
        message: `${candidate} is ${mb}MB. Extraction will work but may be slow. Margins refuses files over 50MB outright.`
      });
    }
  }

  const trackerIssues = await diagnoseTracker(vault, index);
  issues.push(...trackerIssues);

  const staleIssues = await diagnoseStaleSources(vault, index);
  issues.push(...staleIssues);

  return {
    summary: {
      candidates: index.candidates.length,
      filed: index.candidates.length - index.pending.length,
      pending: index.pending.length,
      source_pages: index.sourcePagesCount,
      ingest_roots: index.ingestRoots,
      issues_found: issues.length,
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warn").length
    },
    issues
  };
}

async function diagnoseStaleSources(vault, index) {
  const stale = [];
  for (const [rawRel, sourcePagePath] of index.referenced) {
    let body;
    try {
      body = await readFile(vault.resolveInside(sourcePagePath), "utf8");
    } catch {
      continue;
    }
    const parsed = parseFrontmatter(body);
    if (!parsed) continue;
    const knownSha = typeof parsed.data.raw_sha256 === "string" ? parsed.data.raw_sha256 : null;
    const knownSize = typeof parsed.data.raw_size === "number" ? parsed.data.raw_size : null;
    if (!knownSha && knownSize == null) continue; // no staleness contract — skip silently

    let info;
    try {
      info = await stat(vault.resolveInside(rawRel));
    } catch {
      continue; // raw file missing — orphan-source already reported
    }

    if (knownSize != null && info.size !== knownSize) {
      stale.push({
        kind: "stale-source",
        sourcePage: sourcePagePath,
        rawFile: rawRel,
        reason: "size-mismatch",
        severity: "warn",
        message:
          `Raw file ${rawRel} has size ${info.size} bytes but source page records ${knownSize}. ` +
          `The raw file was modified after compile. Re-run propose_compile_from_raw with force=true to refresh the source page.`
      });
      continue;
    }

    if (knownSha) {
      let currentSha;
      try {
        currentSha = await hashFile(vault.resolveInside(rawRel));
      } catch {
        continue;
      }
      if (currentSha !== knownSha) {
        stale.push({
          kind: "stale-source",
          sourcePage: sourcePagePath,
          rawFile: rawRel,
          reason: "hash-mismatch",
          severity: "warn",
          message:
            `Raw file ${rawRel} content has changed since it was compiled (sha256 differs). ` +
            `Re-run propose_compile_from_raw with force=true to refresh the source page.`
        });
      }
    }
  }
  return stale;
}

async function diagnoseTracker(vault, index) {
  const trackerAbs = vault.resolveInside(TRACKER_PATH);
  let body;
  try {
    body = await readFile(trackerAbs, "utf8");
  } catch {
    if (index.referenced.size === 0) return [];
    return [
      {
        kind: "tracker-missing-file",
        path: TRACKER_PATH,
        severity: "warn",
        message:
          `${TRACKER_PATH} doesn't exist, but the vault has ${index.referenced.size} source page${index.referenced.size === 1 ? "" : "s"}. ` +
          `Accepting a source proposal will create the tracker; or rebuild it manually from the source pages.`
      }
    ];
  }

  const trackerRefs = new Set();
  const trackerSlugs = new Set();
  for (const line of body.split("\n")) {
    const m = line.match(TRACKER_ROW_RE);
    if (!m) continue;
    trackerRefs.add(m[1]);
    trackerSlugs.add(m[3]);
  }

  const issues = [];

  for (const rawRel of index.referenced.keys()) {
    if (!trackerRefs.has(rawRel)) {
      const sourcePage = index.referenced.get(rawRel);
      issues.push({
        kind: "tracker-missing-row",
        sourcePage,
        rawFile: rawRel,
        severity: "warn",
        message:
          `Source page ${sourcePage} references ${rawRel}, but the tracker has no row for it. ` +
          `Source pages authored before Margins's auto-append landed (or imported from another tool) need a manual tracker row. ` +
          `Add the line directly to wiki/ingest-tracker.md, or compile any new file to trigger an auto-update of the surrounding rows. ` +
          `resolve_proposal only updates the tracker for proposals it accepts — it cannot retroactively fill rows for pages already in the vault.`
      });
    }
  }

  const knownSlugs = new Set();
  for (const sourcePage of index.referenced.values()) {
    const slug = sourcePage.split("/").pop().replace(/\.md$/i, "");
    knownSlugs.add(slug);
  }
  for (const slug of trackerSlugs) {
    if (!knownSlugs.has(slug)) {
      issues.push({
        kind: "tracker-orphan-row",
        slug,
        severity: "warn",
        message:
          `Tracker has a row for [[${slug}]], but no source page with that slug exists in the vault. ` +
          `The source page may have been deleted or renamed. Remove the tracker row to keep the index honest.`
      });
    }
  }

  return issues;
}
