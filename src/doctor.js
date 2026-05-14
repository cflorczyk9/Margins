import { readFile, stat } from "node:fs/promises";
import { buildVaultIndex } from "./raw-index.js";

const LARGE_RAW_THRESHOLD = 10 * 1024 * 1024;
const TRACKER_PATH = "wiki/ingest-tracker.md";
const TRACKER_ROW_RE = /^\|\s+(\S+\/\S+?)\s+\|\s+(\S+)\s+\|\s+\[\[([^\]]+)\]\]/;

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

  for (const rel of index.parseFailures || []) {
    issues.push({
      kind: "parse-failure",
      path: rel,
      severity: "error",
      message:
        `Failed to parse frontmatter in ${rel}. Common causes: a stray '---' line in the body, a quoting error in YAML, or a corrupted file. ` +
        `Open the file and fix the frontmatter manually.`
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
          `Re-running resolve_proposal on the source page would add the row. Otherwise the tracker is silently behind reality.`
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
